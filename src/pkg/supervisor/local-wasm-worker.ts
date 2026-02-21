import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

interface Payload {
  wasmPath: string;
  functionName: string;
  args: Array<number | bigint>;
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

function serializeValue(value: unknown): WorkerValue {
  if (value === undefined) return { kind: "undefined" };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "bigint") return { kind: "bigint", value: value.toString() };
  return { kind: "string", value: JSON.stringify(value) };
}

async function run(): Promise<WorkerResponse> {
  const payload = workerData as Payload;
  const bytes = await readFile(payload.wasmPath);
  const module = await WebAssembly.compile(bytes);

  const inertModule = new Proxy(
    {},
    {
      get: () => () => 0
    }
  );
  const imports = new Proxy(
    {},
    {
      get: () => inertModule
    }
  ) as WebAssembly.Imports;

  const instance = await WebAssembly.instantiate(module, imports);
  const fn = instance.exports[payload.functionName];
  if (typeof fn !== "function") {
    return {
      ok: false,
      errorType: "MissingFunction",
      message: `exported function not found: ${payload.functionName}`
    };
  }

  try {
    const output = (fn as Function)(...payload.args);
    return {
      ok: true,
      value: serializeValue(output)
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
