import type { MCPServiceManifest } from "../../types/contracts.js";

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  return input as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = asInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((item) => asNonEmptyString(item))
    .filter((item): item is string => item !== null);
  return out.length === value.length ? out : null;
}

export function isManifest(input: unknown): input is MCPServiceManifest {
  try {
    validateManifest(input);
    return true;
  } catch {
    return false;
  }
}

export function validateManifest(input: unknown): MCPServiceManifest {
  const root = asObject(input);
  if (!root) {
    throw new Error("invalid manifest: expected object");
  }
  if (root.apiVersion !== "clarity.runtime/v1") {
    throw new Error("invalid manifest: apiVersion must be 'clarity.runtime/v1'");
  }
  if (root.kind !== "MCPService") {
    throw new Error("invalid manifest: kind must be 'MCPService'");
  }

  const metadata = asObject(root.metadata);
  if (!metadata) {
    throw new Error("invalid manifest: metadata is required");
  }
  if (!asNonEmptyString(metadata.sourceFile)) {
    throw new Error("invalid manifest: metadata.sourceFile must be a non-empty string");
  }
  if (!asNonEmptyString(metadata.module)) {
    throw new Error("invalid manifest: metadata.module must be a non-empty string");
  }
  if (metadata.serviceId !== undefined && !asNonEmptyString(metadata.serviceId)) {
    throw new Error("invalid manifest: metadata.serviceId must be a non-empty string when provided");
  }
  if (metadata.displayName !== undefined && !asNonEmptyString(metadata.displayName)) {
    throw new Error("invalid manifest: metadata.displayName must be a non-empty string when provided");
  }
  if (
    metadata.serviceType !== "mcp"
    && metadata.serviceType !== "agent"
  ) {
    throw new Error("invalid manifest: metadata.serviceType must be 'mcp' or 'agent'");
  }

  const spec = asObject(root.spec);
  if (!spec) {
    throw new Error("invalid manifest: spec is required");
  }
  if (typeof spec.enabled !== "boolean" || typeof spec.autostart !== "boolean") {
    throw new Error("invalid manifest: spec.enabled and spec.autostart must be booleans");
  }
  if (!asNonEmptyString(spec.policyRef)) {
    throw new Error("invalid manifest: spec.policyRef must be a non-empty string");
  }
  if (spec.toolNamespace !== undefined && !asNonEmptyString(spec.toolNamespace)) {
    throw new Error("invalid manifest: spec.toolNamespace must be a non-empty string when provided");
  }

  const restartPolicy = asObject(spec.restartPolicy);
  if (!restartPolicy) {
    throw new Error("invalid manifest: spec.restartPolicy is required");
  }
  if (
    restartPolicy.mode !== "never"
    && restartPolicy.mode !== "on-failure"
    && restartPolicy.mode !== "always"
  ) {
    throw new Error("invalid manifest: restartPolicy.mode must be never | on-failure | always");
  }
  if ((asInteger(restartPolicy.maxRestarts) ?? -1) < 0) {
    throw new Error("invalid manifest: restartPolicy.maxRestarts must be an integer >= 0");
  }
  if ((asPositiveInteger(restartPolicy.windowSeconds) ?? 0) <= 0) {
    throw new Error("invalid manifest: restartPolicy.windowSeconds must be a positive integer");
  }

  const origin = asObject(spec.origin);
  if (!origin) {
    throw new Error("invalid manifest: spec.origin is required");
  }
  if (origin.type === "local_wasm") {
    if (!asNonEmptyString(origin.wasmPath) || !asNonEmptyString(origin.entry)) {
      throw new Error("invalid manifest: local_wasm origin requires wasmPath and entry");
    }
  } else if (origin.type === "remote_mcp") {
    const endpoint = asNonEmptyString(origin.endpoint);
    if (!endpoint) {
      throw new Error("invalid manifest: remote_mcp origin requires endpoint");
    }
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("protocol");
      }
    } catch {
      throw new Error("invalid manifest: remote_mcp endpoint must be a valid http(s) URL");
    }
    if (origin.transport !== "streamable_http" && origin.transport !== "sse_http") {
      throw new Error("invalid manifest: remote_mcp transport must be streamable_http | sse_http");
    }
    if (origin.authRef !== undefined && !asNonEmptyString(origin.authRef)) {
      throw new Error("invalid manifest: remote_mcp authRef must be a non-empty string when provided");
    }
    if (origin.timeoutMs !== undefined && !asPositiveInteger(origin.timeoutMs)) {
      throw new Error("invalid manifest: remote_mcp timeoutMs must be a positive integer when provided");
    }
    if (origin.maxPayloadBytes !== undefined && !asPositiveInteger(origin.maxPayloadBytes)) {
      throw new Error("invalid manifest: remote_mcp maxPayloadBytes must be a positive integer when provided");
    }
    if (origin.maxConcurrency !== undefined && !asPositiveInteger(origin.maxConcurrency)) {
      throw new Error("invalid manifest: remote_mcp maxConcurrency must be a positive integer when provided");
    }
    if (origin.allowedTools !== undefined && !asStringArray(origin.allowedTools)) {
      throw new Error("invalid manifest: remote_mcp allowedTools must be an array of strings when provided");
    }
  } else {
    throw new Error("invalid manifest: must match clarity.runtime/v1 MCPService shape");
  }

  return input as MCPServiceManifest;
}
