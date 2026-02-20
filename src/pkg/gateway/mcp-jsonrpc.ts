export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export function isJsonRpcRequest(input: unknown): input is JsonRpcRequest {
  if (!input || typeof input !== "object") return false;
  const maybe = input as Partial<JsonRpcRequest>;
  return maybe.jsonrpc === "2.0" && typeof maybe.method === "string";
}

export function success(id: string | number | null, result: unknown): JsonRpcSuccess {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

export function failure(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {})
    }
  };
}
