import { readFile } from "node:fs/promises";
import * as nodeFs from "node:fs";
import { Worker, parentPort, workerData } from "node:worker_threads";

interface Payload {
  wasmPath: string;
  functionName: string;
  args: unknown[];
  expectStringResult?: boolean;
  argTypes?: Array<WasmMarshalType | undefined>;
  resultType?: WasmMarshalType;
}

interface WasmMarshalRecordField {
  name: string;
  type: WasmMarshalType;
}

type WasmMarshalType =
  | { kind: "Int64" }
  | { kind: "Float64" }
  | { kind: "Bool" }
  | { kind: "String" }
  | { kind: "Timestamp" }
  | { kind: "List"; element: WasmMarshalType }
  | { kind: "Record"; fields: WasmMarshalRecordField[] }
  | { kind: "Option"; inner: WasmMarshalType }
  | { kind: "Result"; ok: WasmMarshalType; err: WasmMarshalType };

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
  heapPtr = (heapPtr + 7) & ~7;
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
  // Result<T,E> uses aligned union layout: [tag:i32][pad:i32][payload:i32...]
  const ptr = alloc(12);
  const view = new DataView(requireMemory().buffer);
  view.setInt32(ptr, ok ? 0 : 1, true);
  view.setInt32(ptr + 8, valuePtr, true);
  return ptr;
}

function allocOptionI32(value: number | null): number {
  const ptr = alloc(12);
  const view = new DataView(requireMemory().buffer);
  if (value === null) {
    view.setInt32(ptr, 1, true);
  } else {
    view.setInt32(ptr, 0, true);
    view.setInt32(ptr + 8, value, true);
  }
  return ptr;
}

function allocOptionI64(value: bigint | null): number {
  const ptr = alloc(16);
  const view = new DataView(requireMemory().buffer);
  if (value === null) {
    view.setInt32(ptr, 1, true);
  } else {
    view.setInt32(ptr, 0, true);
    view.setBigInt64(ptr + 8, value, true);
  }
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
    return nodeFs.readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function readEnvSecretWithOverride(primary: string, fallbackFileVar: string): string {
  const overrideEnvName = (process.env.CLARITY_RUNTIME_CHAT_API_KEY_ENV ?? "").trim();
  if (overrideEnvName.length > 0) {
    const override = (process.env[overrideEnvName] ?? "").trim();
    if (override.length > 0) {
      return override;
    }
    const overrideFilePath = (process.env[`${overrideEnvName}_FILE`] ?? "").trim();
    if (overrideFilePath.length > 0) {
      try {
        const fromFile = nodeFs.readFileSync(overrideFilePath, "utf8").trim();
        if (fromFile.length > 0) {
          return fromFile;
        }
      } catch {
        // Ignore and fall through to provider defaults.
      }
    }
  }
  return readEnvSecret(primary, fallbackFileVar);
}

function callOpenAiChat(model: string, messages: Array<{ role: string; content: string }>): number {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
  const apiKey = readEnvSecretWithOverride("OPENAI_API_KEY", "OPENAI_API_KEY_FILE");
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
  const apiKey = readEnvSecretWithOverride("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_FILE");
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

function jsonToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function jsonGet(json: string, key: string): number {
  try {
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return allocOptionI32(null);
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      return allocOptionI32(null);
    }
    const value = (parsed as Record<string, unknown>)[key];
    if (value === null || value === undefined) {
      return allocOptionI32(null);
    }
    return allocOptionI32(writeString(jsonToString(value)));
  } catch {
    return allocOptionI32(null);
  }
}

function jsonGetPath(json: string, pathValue: string): number {
  try {
    let current: unknown = JSON.parse(json);
    const segments = pathValue.split(".");
    for (const segment of segments) {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return allocOptionI32(null);
      }
      const object = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(object, segment)) {
        return allocOptionI32(null);
      }
      current = object[segment];
    }
    if (current === null || current === undefined) {
      return allocOptionI32(null);
    }
    return allocOptionI32(writeString(jsonToString(current)));
  } catch {
    return allocOptionI32(null);
  }
}

function jsonGetNested(json: string, pathValue: string): number {
  try {
    let node: unknown = JSON.parse(json);
    const parts = pathValue.split(".");
    for (const part of parts) {
      if (node === null || node === undefined) {
        return allocOptionI32(null);
      }
      if (Array.isArray(node)) {
        const index = Number.parseInt(part, 10);
        if (Number.isNaN(index) || index < 0 || index >= node.length) {
          return allocOptionI32(null);
        }
        node = node[index];
      } else if (typeof node === "object") {
        const object = node as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(object, part)) {
          return allocOptionI32(null);
        }
        node = object[part];
      } else {
        return allocOptionI32(null);
      }
    }
    if (node === null || node === undefined) {
      return allocOptionI32(null);
    }
    return allocOptionI32(writeString(typeof node === "string" ? node : JSON.stringify(node)));
  } catch {
    return allocOptionI32(null);
  }
}

function jsonArrayLength(json: string): number {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return allocOptionI64(null);
    }
    return allocOptionI64(BigInt(parsed.length));
  } catch {
    return allocOptionI64(null);
  }
}

function jsonArrayGet(json: string, index: bigint): number {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return allocOptionI32(null);
    }
    const itemIndex = Number(index);
    if (!Number.isFinite(itemIndex) || itemIndex < 0 || itemIndex >= parsed.length) {
      return allocOptionI32(null);
    }
    const value = parsed[itemIndex];
    return allocOptionI32(writeString(typeof value === "string" ? value : JSON.stringify(value)));
  } catch {
    return allocOptionI32(null);
  }
}

function jsonKeys(json: string): number {
  try {
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return allocOptionI32(null);
    }
    const keys = Object.keys(parsed as Record<string, unknown>).map((key) => writeString(key));
    return allocOptionI32(allocListI32(keys));
  } catch {
    return allocOptionI32(null);
  }
}

function hitlAsk(key: string, question: string): string {
  const dir = process.env.CLARITY_HITL_DIR ?? ".clarity-hitl";
  const timeoutRaw = Number.parseInt(process.env.CLARITY_HITL_TIMEOUT_SECS ?? "600", 10);
  const timeoutSecs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 600;

  nodeFs.mkdirSync(dir, { recursive: true });

  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  const questionFile = `${dir}/${safeKey}.question`;
  const answerFile = `${dir}/${safeKey}.answer`;

  nodeFs.writeFileSync(
    questionFile,
    JSON.stringify({
      key,
      question,
      timestamp: Date.now(),
      pid: process.pid
    }),
    "utf8"
  );

  const sab = new SharedArrayBuffer(4);
  const ctrl = new Int32Array(sab);
  const deadline = Date.now() + timeoutSecs * 1000;
  const pollMs = 500;

  while (Date.now() < deadline) {
    Atomics.wait(ctrl, 0, 0, pollMs);
    if (!nodeFs.existsSync(answerFile)) {
      continue;
    }
    try {
      const answer = nodeFs.readFileSync(answerFile, "utf8").trim();
      try {
        nodeFs.unlinkSync(answerFile);
      } catch {
        // Ignore cleanup race.
      }
      try {
        nodeFs.unlinkSync(questionFile);
      } catch {
        // Ignore cleanup race.
      }
      return answer;
    } catch {
      // Broker may still be writing; retry on next loop.
    }
  }

  try {
    nodeFs.unlinkSync(questionFile);
  } catch {
    // Ignore cleanup race.
  }
  return "[hitl_ask timeout]";
}

function stringifyWithBigInts(value: unknown): string {
  return JSON.stringify(value, (_key, current) => (typeof current === "bigint" ? current.toString() : current));
}

function alignTo(value: number, alignment: number): number {
  if (alignment <= 1) {
    return value;
  }
  return (value + alignment - 1) & ~(alignment - 1);
}

function isInt64LikeType(type: WasmMarshalType): boolean {
  return type.kind === "Int64" || type.kind === "Timestamp";
}

function isFloat64Type(type: WasmMarshalType): boolean {
  return type.kind === "Float64";
}

function fieldAlign(type: WasmMarshalType): number {
  if (isInt64LikeType(type) || isFloat64Type(type)) {
    return 8;
  }
  return 4;
}

function fieldSize(type: WasmMarshalType): number {
  if (isInt64LikeType(type) || isFloat64Type(type)) {
    return 8;
  }
  return 4;
}

function recordLayout(fields: WasmMarshalRecordField[]): Array<WasmMarshalRecordField & { offset: number }> {
  const layout: Array<WasmMarshalRecordField & { offset: number }> = [];
  let offset = 0;
  for (const field of fields) {
    offset = alignTo(offset, fieldAlign(field.type));
    layout.push({ ...field, offset });
    offset += fieldSize(field.type);
  }
  return layout;
}

function recordSize(fields: WasmMarshalRecordField[]): number {
  const layout = recordLayout(fields);
  if (layout.length === 0) {
    return 4;
  }
  const last = layout[layout.length - 1];
  return alignTo(last.offset + fieldSize(last.type), 4);
}

function unionSizeForPayload(payloadType: WasmMarshalType): number {
  return 8 + recordSize([{ name: "payload", type: payloadType }]);
}

function unionSizeForResult(ok: WasmMarshalType, err: WasmMarshalType): number {
  const okSize = recordSize([{ name: "ok", type: ok }]);
  const errSize = recordSize([{ name: "err", type: err }]);
  return 8 + Math.max(okSize, errSize);
}

function coerceInt64(value: unknown, label: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new Error(`${label}: expected Int64-compatible value`);
}

function coerceFloat64(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label}: expected Float64-compatible value`);
}

function coerceBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "bigint") {
    return value !== 0n;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized.length === 0) {
      return false;
    }
  }
  return false;
}

function asRecordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: expected record/object value`);
  }
  return value as Record<string, unknown>;
}

function asPointer(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber) && asNumber >= 0) {
      return asNumber;
    }
  }
  throw new Error(`${label}: expected pointer value`);
}

function storeMarshalledValue(view: DataView, ptr: number, offset: number, type: WasmMarshalType, value: unknown, label: string): void {
  const base = ptr + offset;
  if (isInt64LikeType(type)) {
    view.setBigInt64(base, coerceInt64(value, label), true);
    return;
  }
  if (isFloat64Type(type)) {
    view.setFloat64(base, coerceFloat64(value, label), true);
    return;
  }
  if (type.kind === "Bool") {
    view.setInt32(base, coerceBool(value) ? 1 : 0, true);
    return;
  }
  view.setInt32(base, asPointer(value, label), true);
}

function marshalValueByType(type: WasmMarshalType, value: unknown, label: string): number | bigint {
  if (isInt64LikeType(type)) {
    return coerceInt64(value, label);
  }
  if (type.kind === "Float64") {
    return coerceFloat64(value, label);
  }
  if (type.kind === "Bool") {
    return coerceBool(value) ? 1 : 0;
  }
  if (type.kind === "String") {
    return writeString(String(value ?? ""));
  }
  if (type.kind === "List") {
    if (!Array.isArray(value)) {
      throw new Error(`${label}: expected list/array value`);
    }
    const elemType = type.element;
    const elemSize = fieldSize(elemType);
    const ptr = alloc(4 + value.length * elemSize);
    const view = new DataView(requireMemory().buffer);
    view.setInt32(ptr, value.length, true);
    for (let i = 0; i < value.length; i += 1) {
      const itemValue = marshalValueByType(elemType, value[i], `${label}[${i}]`);
      storeMarshalledValue(view, ptr, 4 + i * elemSize, elemType, itemValue, `${label}[${i}]`);
    }
    return ptr;
  }
  if (type.kind === "Record") {
    const record = asRecordValue(value, label);
    const layout = recordLayout(type.fields);
    const ptr = alloc(recordSize(type.fields));
    const view = new DataView(requireMemory().buffer);
    for (const field of layout) {
      const fieldValue = marshalValueByType(
        field.type,
        record[field.name],
        `${label}.${field.name}`
      );
      storeMarshalledValue(view, ptr, field.offset, field.type, fieldValue, `${label}.${field.name}`);
    }
    return ptr;
  }
  if (type.kind === "Option") {
    const ptr = alloc(unionSizeForPayload(type.inner));
    const view = new DataView(requireMemory().buffer);
    if (value === null || value === undefined) {
      view.setInt32(ptr, 1, true);
      return ptr;
    }
    view.setInt32(ptr, 0, true);
    const payload = marshalValueByType(type.inner, value, `${label}.some`);
    storeMarshalledValue(view, ptr, 8, type.inner, payload, `${label}.some`);
    return ptr;
  }
  if (type.kind === "Result") {
    const ptr = alloc(unionSizeForResult(type.ok, type.err));
    const view = new DataView(requireMemory().buffer);
    const record = asRecordValue(value, label);
    if (Object.prototype.hasOwnProperty.call(record, "ok")) {
      view.setInt32(ptr, 0, true);
      const payload = marshalValueByType(type.ok, record.ok, `${label}.ok`);
      storeMarshalledValue(view, ptr, 8, type.ok, payload, `${label}.ok`);
      return ptr;
    }
    if (Object.prototype.hasOwnProperty.call(record, "err")) {
      view.setInt32(ptr, 1, true);
      const payload = marshalValueByType(type.err, record.err, `${label}.err`);
      storeMarshalledValue(view, ptr, 8, type.err, payload, `${label}.err`);
      return ptr;
    }
    throw new Error(`${label}: expected Result object with 'ok' or 'err'`);
  }
  throw new Error(`${label}: unsupported marshal type '${(type as { kind?: string }).kind ?? "unknown"}'`);
}

function readMarshalledValue(type: WasmMarshalType, rawValue: unknown, label: string): unknown {
  if (isInt64LikeType(type)) {
    return coerceInt64(rawValue, label);
  }
  if (type.kind === "Float64") {
    return coerceFloat64(rawValue, label);
  }
  if (type.kind === "Bool") {
    return coerceBool(rawValue);
  }
  const ptr = asPointer(rawValue, label);
  const view = new DataView(requireMemory().buffer);
  if (type.kind === "String") {
    return readString(ptr);
  }
  if (type.kind === "List") {
    const len = view.getInt32(ptr, true);
    const elemType = type.element;
    const elemSize = fieldSize(elemType);
    const out: unknown[] = [];
    for (let i = 0; i < len; i += 1) {
      const offset = ptr + 4 + i * elemSize;
      let rawItem: unknown;
      if (isInt64LikeType(elemType)) {
        rawItem = view.getBigInt64(offset, true);
      } else if (isFloat64Type(elemType)) {
        rawItem = view.getFloat64(offset, true);
      } else {
        rawItem = view.getInt32(offset, true);
      }
      out.push(readMarshalledValue(elemType, rawItem, `${label}[${i}]`));
    }
    return out;
  }
  if (type.kind === "Record") {
    const out: Record<string, unknown> = {};
    const layout = recordLayout(type.fields);
    for (const field of layout) {
      const offset = ptr + field.offset;
      let rawField: unknown;
      if (isInt64LikeType(field.type)) {
        rawField = view.getBigInt64(offset, true);
      } else if (isFloat64Type(field.type)) {
        rawField = view.getFloat64(offset, true);
      } else {
        rawField = view.getInt32(offset, true);
      }
      out[field.name] = readMarshalledValue(field.type, rawField, `${label}.${field.name}`);
    }
    return out;
  }
  if (type.kind === "Option") {
    const tag = view.getInt32(ptr, true);
    if (tag === 1) {
      return null;
    }
    let payloadRaw: unknown;
    if (isInt64LikeType(type.inner)) {
      payloadRaw = view.getBigInt64(ptr + 8, true);
    } else if (isFloat64Type(type.inner)) {
      payloadRaw = view.getFloat64(ptr + 8, true);
    } else {
      payloadRaw = view.getInt32(ptr + 8, true);
    }
    return readMarshalledValue(type.inner, payloadRaw, `${label}.some`);
  }
  if (type.kind === "Result") {
    const tag = view.getInt32(ptr, true);
    if (tag === 0) {
      let okRaw: unknown;
      if (isInt64LikeType(type.ok)) {
        okRaw = view.getBigInt64(ptr + 8, true);
      } else if (isFloat64Type(type.ok)) {
        okRaw = view.getFloat64(ptr + 8, true);
      } else {
        okRaw = view.getInt32(ptr + 8, true);
      }
      return { ok: readMarshalledValue(type.ok, okRaw, `${label}.ok`) };
    }
    let errRaw: unknown;
    if (isInt64LikeType(type.err)) {
      errRaw = view.getBigInt64(ptr + 8, true);
    } else if (isFloat64Type(type.err)) {
      errRaw = view.getFloat64(ptr + 8, true);
    } else {
      errRaw = view.getInt32(ptr + 8, true);
    }
    return { err: readMarshalledValue(type.err, errRaw, `${label}.err`) };
  }
  return undefined;
}

function serializeValue(value: unknown, expectStringResult: boolean, resultType?: WasmMarshalType): WorkerValue {
  if (resultType) {
    const decoded = readMarshalledValue(resultType, value, "result");
    if (decoded === undefined) {
      return { kind: "undefined" };
    }
    if (typeof decoded === "string") {
      return { kind: "string", value: decoded };
    }
    if (typeof decoded === "number") {
      return { kind: "number", value: decoded };
    }
    if (typeof decoded === "boolean") {
      return { kind: "boolean", value: decoded };
    }
    if (typeof decoded === "bigint") {
      return { kind: "bigint", value: decoded.toString() };
    }
    return { kind: "string", value: stringifyWithBigInts(decoded) };
  }
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

  return { kind: "string", value: stringifyWithBigInts(value) };
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
    },
    json_get(jsonPtr: number, keyPtr: number): number {
      return jsonGet(readString(jsonPtr), readString(keyPtr));
    },
    json_get_path(jsonPtr: number, pathPtr: number): number {
      return jsonGetPath(readString(jsonPtr), readString(pathPtr));
    },
    json_get_nested(jsonPtr: number, pathPtr: number): number {
      return jsonGetNested(readString(jsonPtr), readString(pathPtr));
    },
    json_array_length(jsonPtr: number): number {
      return jsonArrayLength(readString(jsonPtr));
    },
    json_array_get(jsonPtr: number, index: bigint): number {
      return jsonArrayGet(readString(jsonPtr), index);
    },
    json_keys(jsonPtr: number): number {
      return jsonKeys(readString(jsonPtr));
    },
    json_escape_string(ptr: number): number {
      const source = readString(ptr);
      return writeString(JSON.stringify(source).slice(1, -1));
    },
    get_secret(namePtr: number): number {
      const secretName = readString(namePtr);
      const value = process.env[secretName];
      if (typeof value !== "string") {
        return allocOptionI32(null);
      }
      return allocOptionI32(writeString(value));
    },
    hitl_ask(keyPtr: number, questionPtr: number): number {
      const key = readString(keyPtr);
      const question = readString(questionPtr);
      return writeString(hitlAsk(key, question));
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

function prepareArgs(rawArgs: unknown[], argTypes?: Array<WasmMarshalType | undefined>): Array<number | bigint> {
  return rawArgs.map((arg, index) => {
    const explicitType = Array.isArray(argTypes) ? argTypes[index] : undefined;
    if (explicitType) {
      return marshalValueByType(explicitType, arg, `arg[${index}]`);
    }
    if (typeof arg === "string") {
      return writeString(arg);
    }
    if (typeof arg === "boolean") {
      return arg ? 1 : 0;
    }
    if (typeof arg === "number" || typeof arg === "bigint") {
      return arg;
    }
    throw new Error(`unsupported argument type '${typeof arg}' for wasm call`);
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
    const output = (fn as Function)(...prepareArgs(payload.args, payload.argTypes));
    return {
      ok: true,
      value: serializeValue(output, payload.expectStringResult === true, payload.resultType)
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
