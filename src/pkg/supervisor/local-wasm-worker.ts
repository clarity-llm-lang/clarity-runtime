import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Worker, parentPort, workerData } from "node:worker_threads";

interface Payload {
  wasmPath: string;
  functionName: string;
  args: Array<number | bigint | string>;
  expectStringResult?: boolean;
}

type WorkerValue =
  | { kind: "undefined" }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "bigint"; value: string };

type WorkerResponse =
  | {
      ok: true;
      value: WorkerValue;
    }
  | {
      ok: false;
      errorType: "TypeError" | "RuntimeError" | "MissingFunction";
      message: string;
    };

interface SyncHttpResponse {
  ok: boolean;
  status: number;
  body: string;
}

const HTTP_MAX_BODY = 8 * 1024 * 1024;

const HTTP_WORKER_CODE = `
const { workerData } = require('worker_threads');
const https = require('https');
const http = require('http');
const { sab, url: initialUrl, method, headers, body, timeoutMs, followRedirects } = workerData;
const ctrl = new Int32Array(sab, 0, 1);
const view = new DataView(sab);
const MAX_BODY = sab.byteLength - 12;

function finish(done, status, bodyStr) {
  const encoded = Buffer.from(bodyStr || '', 'utf8');
  const len = Math.min(encoded.length, MAX_BODY);
  view.setInt32(4, status, true);
  view.setInt32(8, len, true);
  new Uint8Array(sab, 12, len).set(encoded.subarray(0, len));
  Atomics.store(ctrl, 0, done);
  Atomics.notify(ctrl, 0);
}

function doRequest(url, redirectCount) {
  if (redirectCount > 5) { finish(3, 0, 'Too many redirects'); return; }
  let urlObj;
  try { urlObj = new URL(url); } catch(e) { finish(3, 0, 'Invalid URL: ' + String(e)); return; }
  const mod = urlObj.protocol === 'https:' ? https : http;
  const port = urlObj.port ? parseInt(urlObj.port, 10) : (urlObj.protocol === 'https:' ? 443 : 80);
  const reqOpts = {
    hostname: urlObj.hostname,
    port,
    path: (urlObj.pathname || '/') + (urlObj.search || ''),
    method: method || 'GET',
    headers: headers || {},
    timeout: timeoutMs || 10000,
  };
  const req = mod.request(reqOpts, function(res) {
    if (followRedirects && [301, 302, 303, 307, 308].indexOf(res.statusCode) !== -1 && res.headers.location) {
      res.resume();
      let redirectUrl;
      try { redirectUrl = new URL(res.headers.location, url).href; }
      catch(e) { finish(3, 0, 'Invalid redirect URL'); return; }
      doRequest(redirectUrl, redirectCount + 1);
      return;
    }
    let chunks = [];
    res.on('data', function(chunk) { chunks.push(Buffer.from(chunk)); });
    res.on('end', function() {
      const data = Buffer.concat(chunks);
      const done = (res.statusCode >= 200 && res.statusCode < 300) ? 1 : 2;
      finish(done, res.statusCode, data.toString('utf8'));
    });
  });
  req.on('error', function(e) { finish(3, 0, e.message); });
  req.on('timeout', function() { req.destroy(); finish(4, 0, 'Request timed out'); });
  if (body !== undefined && body !== null) { req.write(body); }
  req.end();
}

doRequest(initialUrl, 0);
`;

let memory: WebAssembly.Memory | null = null;
let heapPtr = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

function requireMemory(): WebAssembly.Memory {
  if (!memory) {
    throw new Error("wasm memory is not initialized");
  }
  return memory;
}

function alloc(size: number): number {
  const mem = requireMemory();
  const alignedSize = Math.max(1, size);
  heapPtr = (heapPtr + 3) & ~3;
  const ptr = heapPtr;
  const needed = ptr + alignedSize;
  if (needed > mem.buffer.byteLength) {
    const pages = Math.ceil((needed - mem.buffer.byteLength) / 65536);
    mem.grow(pages);
  }
  heapPtr = ptr + alignedSize;
  return ptr;
}

function allocResultString(ok: boolean, valuePtr: number): number {
  const ptr = alloc(8);
  const view = new DataView(requireMemory().buffer);
  view.setInt32(ptr, ok ? 0 : 1, true);
  view.setInt32(ptr + 4, valuePtr, true);
  return ptr;
}

function readString(ptr: number): string {
  const mem = requireMemory();
  const view = new DataView(mem.buffer);
  if (ptr < 0 || ptr + 4 > mem.buffer.byteLength) {
    throw new Error(`invalid string pointer: ${ptr}`);
  }
  const len = view.getUint32(ptr, true);
  const end = ptr + 4 + len;
  if (end < ptr + 4 || end > mem.buffer.byteLength) {
    throw new Error(`string length out of bounds at pointer: ${ptr}`);
  }
  const bytes = new Uint8Array(mem.buffer, ptr + 4, len);
  return decoder.decode(bytes);
}

function tryReadString(ptr: number): string | undefined {
  if (!Number.isInteger(ptr) || ptr < 0) {
    return undefined;
  }
  const mem = memory;
  if (!mem) {
    return undefined;
  }
  if (ptr + 4 > mem.buffer.byteLength) {
    return undefined;
  }
  try {
    const view = new DataView(mem.buffer);
    const len = view.getUint32(ptr, true);
    if (len > 2_000_000) {
      return undefined;
    }
    const end = ptr + 4 + len;
    if (end < ptr + 4 || end > mem.buffer.byteLength) {
      return undefined;
    }
    const bytes = new Uint8Array(mem.buffer, ptr + 4, len);
    return strictDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function writeString(value: string): number {
  const bytes = encoder.encode(value);
  const ptr = alloc(4 + bytes.length);
  const view = new DataView(requireMemory().buffer);
  view.setUint32(ptr, bytes.length, true);
  new Uint8Array(requireMemory().buffer, ptr + 4, bytes.length).set(bytes);
  return ptr;
}

function allocListI32(items: number[]): number {
  const ptr = alloc(4 + items.length * 4);
  const view = new DataView(requireMemory().buffer);
  view.setInt32(ptr, items.length, true);
  for (let i = 0; i < items.length; i += 1) {
    view.setInt32(ptr + 4 + i * 4, items[i], true);
  }
  return ptr;
}

function syncHttpRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
}): SyncHttpResponse {
  const sab = new SharedArrayBuffer(12 + HTTP_MAX_BODY);
  const ctrl = new Int32Array(sab, 0, 1);
  const worker = new Worker(HTTP_WORKER_CODE, {
    eval: true,
    workerData: {
      sab,
      url: opts.url,
      method: opts.method ?? "GET",
      headers: opts.headers ?? {},
      body: opts.body ?? null,
      timeoutMs: opts.timeoutMs ?? 10000,
      followRedirects: opts.followRedirects ?? false
    }
  });

  const waitResult = Atomics.wait(ctrl, 0, 0, (opts.timeoutMs ?? 10000) + 2000);
  worker.terminate().catch(() => {});

  const done = ctrl[0];
  const view = new DataView(sab);
  const status = view.getInt32(4, true);
  const bodyLen = view.getInt32(8, true);
  const body = Buffer.from(new Uint8Array(sab, 12, Math.max(0, bodyLen))).toString("utf-8");

  if (waitResult === "timed-out" || done === 0 || done === 4) {
    return { ok: false, status: 0, body: "Request timed out" };
  }
  if (done === 3) {
    return { ok: false, status: 0, body };
  }

  return { ok: done === 1, status, body };
}

function readEnvSecret(primary: string, fallbackFileVar: string): string {
  const direct = (process.env[primary] ?? "").trim();
  if (direct.length > 0) {
    return direct;
  }
  const path = (process.env[fallbackFileVar] ?? "").trim();
  if (!path) {
    return "";
  }
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function callOpenAiChat(model: string, messages: Array<{ role: string; content: string }>): number {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
  const apiKey = readEnvSecret("OPENAI_API_KEY", "OPENAI_API_KEY_FILE");
  if (!apiKey) {
    return allocResultString(false, writeString("OPENAI_API_KEY is not set"));
  }

  try {
    const response = syncHttpRequest({
      url: `${baseUrl}/v1/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4096
      }),
      timeoutMs: 120000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.body}`);
    }

    const parsed = JSON.parse(response.body) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = parsed.choices?.[0]?.message?.content ?? "";
    return allocResultString(true, writeString(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return allocResultString(false, writeString(message));
  }
}

function callAnthropic(model: string, messages: Array<{ role: string; content: string }>): number {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  const apiKey = readEnvSecret("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_FILE");
  if (!apiKey) {
    return allocResultString(false, writeString("ANTHROPIC_API_KEY is not set"));
  }

  const system = messages.find((message) => message.role === "system")?.content;
  const userMessages = messages.filter((message) => message.role !== "system");

  try {
    const response = syncHttpRequest({
      url: `${baseUrl}/v1/messages`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: userMessages
      }),
      timeoutMs: 120000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.body}`);
    }

    const parsed = JSON.parse(response.body) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = parsed.content?.find((item) => item.type === "text")?.text ?? "";
    return allocResultString(true, writeString(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return allocResultString(false, writeString(message));
  }
}

function callModel(model: string, messages: Array<{ role: string; content: string }>): number {
  if (model.startsWith("claude-")) {
    return callAnthropic(model, messages);
  }
  return callOpenAiChat(model, messages);
}

function serializeValue(value: unknown, expectStringResult: boolean): WorkerValue {
  if (value === undefined) {
    return { kind: "undefined" };
  }
  if (typeof value === "string") {
    return { kind: "string", value };
  }
  if (typeof value === "number") {
    if (expectStringResult) {
      const decoded = tryReadString(value);
      if (decoded !== undefined) {
        return { kind: "string", value: decoded };
      }
    }
    return { kind: "number", value };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }
  if (typeof value === "bigint") {
    if (expectStringResult) {
      const asNumber = Number(value);
      if (Number.isSafeInteger(asNumber)) {
        const decoded = tryReadString(asNumber);
        if (decoded !== undefined) {
          return { kind: "string", value: decoded };
        }
      }
    }
    return { kind: "bigint", value: value.toString() };
  }

  return { kind: "string", value: JSON.stringify(value) };
}

function buildImports(): WebAssembly.Imports {
  const knownEnv = {
    string_concat(aPtr: number, bPtr: number): number {
      return writeString(readString(aPtr) + readString(bPtr));
    },
    string_eq(aPtr: number, bPtr: number): number {
      return readString(aPtr) === readString(bPtr) ? 1 : 0;
    },
    string_length(ptr: number): bigint {
      return BigInt(readString(ptr).length);
    },
    substring(ptr: number, start: bigint, length: bigint): number {
      const source = readString(ptr);
      return writeString(source.substring(Number(start), Number(start) + Number(length)));
    },
    char_at(ptr: number, index: bigint): number {
      const source = readString(ptr);
      const idx = Number(index);
      return writeString(idx >= 0 && idx < source.length ? source[idx] : "");
    },
    contains(haystackPtr: number, needlePtr: number): number {
      return readString(haystackPtr).includes(readString(needlePtr)) ? 1 : 0;
    },
    string_starts_with(strPtr: number, prefixPtr: number): number {
      return readString(strPtr).startsWith(readString(prefixPtr)) ? 1 : 0;
    },
    string_ends_with(strPtr: number, suffixPtr: number): number {
      return readString(strPtr).endsWith(readString(suffixPtr)) ? 1 : 0;
    },
    index_of(haystackPtr: number, needlePtr: number): bigint {
      return BigInt(readString(haystackPtr).indexOf(readString(needlePtr)));
    },
    trim(ptr: number): number {
      return writeString(readString(ptr).trim());
    },
    split(strPtr: number, delimiterPtr: number): number {
      const parts = readString(strPtr).split(readString(delimiterPtr));
      const pointers = parts.map((part) => writeString(part));
      return allocListI32(pointers);
    },
    string_replace(strPtr: number, searchPtr: number, replacementPtr: number): number {
      const source = readString(strPtr);
      const search = readString(searchPtr);
      const replacement = readString(replacementPtr);
      if (search.length === 0) {
        return writeString(source);
      }
      return writeString(source.split(search).join(replacement));
    },
    string_repeat(strPtr: number, count: bigint): number {
      const n = Number(count);
      if (n <= 0) {
        return writeString("");
      }
      return writeString(readString(strPtr).repeat(n));
    },
    char_code(ptr: number): bigint {
      const source = readString(ptr);
      if (source.length === 0) {
        return 0n;
      }
      return BigInt(source.codePointAt(0) ?? 0);
    },
    char_from_code(code: bigint): number {
      return writeString(String.fromCodePoint(Number(code)));
    },
    call_model(modelPtr: number, promptPtr: number): number {
      const model = readString(modelPtr);
      const prompt = readString(promptPtr);
      return callModel(model, [{ role: "user", content: prompt }]);
    },
    call_model_system(modelPtr: number, systemPtr: number, promptPtr: number): number {
      const model = readString(modelPtr);
      const system = readString(systemPtr);
      const prompt = readString(promptPtr);
      return callModel(model, [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]);
    }
  };

  const env = new Proxy(knownEnv as Record<string, (...args: unknown[]) => unknown>, {
    get(target, prop: string | symbol) {
      if (typeof prop === "string" && prop in target) {
        return target[prop];
      }
      return () => {
        throw new Error(`unsupported host import: env.${String(prop)}`);
      };
    }
  });

  return { env };
}

function prepareArgs(rawArgs: Array<number | bigint | string>): Array<number | bigint> {
  return rawArgs.map((arg) => {
    if (typeof arg === "string") {
      return writeString(arg);
    }
    return arg;
  });
}

async function run(): Promise<WorkerResponse> {
  const payload = workerData as Payload;
  const bytes = await readFile(payload.wasmPath);
  const module = await WebAssembly.compile(bytes);
  const imports = buildImports();
  const instance = await WebAssembly.instantiate(module, imports);

  const memoryExport = instance.exports.memory;
  if (!(memoryExport instanceof WebAssembly.Memory)) {
    return {
      ok: false,
      errorType: "RuntimeError",
      message: "wasm module does not export memory"
    };
  }

  memory = memoryExport;
  const heapBaseExport = instance.exports.__heap_base as WebAssembly.Global | number | undefined;
  if (typeof heapBaseExport === "number") {
    heapPtr = heapBaseExport;
  } else if (heapBaseExport && typeof heapBaseExport.value === "number") {
    heapPtr = heapBaseExport.value;
  }

  const fn = instance.exports[payload.functionName];
  if (typeof fn !== "function") {
    return {
      ok: false,
      errorType: "MissingFunction",
      message: `exported function not found: ${payload.functionName}`
    };
  }

  try {
    const output = (fn as Function)(...prepareArgs(payload.args));
    return {
      ok: true,
      value: serializeValue(output, payload.expectStringResult === true)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errorType: error instanceof TypeError ? "TypeError" : "RuntimeError",
      message
    };
  }
}

run()
  .then((result) => {
    parentPort?.postMessage(result);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const result: WorkerResponse = {
      ok: false,
      errorType: "RuntimeError",
      message
    };
    parentPort?.postMessage(result);
  });
