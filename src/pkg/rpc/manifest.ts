import type { MCPServiceManifest } from "../../types/contracts.js";

export function isManifest(input: unknown): input is MCPServiceManifest {
  if (!input || typeof input !== "object") return false;
  const v = input as Partial<MCPServiceManifest>;

  return (
    v.apiVersion === "clarity.runtime/v1" &&
    v.kind === "MCPService" &&
    !!v.metadata &&
    typeof v.metadata.sourceFile === "string" &&
    typeof v.metadata.module === "string" &&
    !!v.spec &&
    !!v.spec.origin &&
    typeof v.spec.enabled === "boolean" &&
    typeof v.spec.autostart === "boolean"
  );
}

export function validateManifest(input: unknown): MCPServiceManifest {
  if (!isManifest(input)) {
    throw new Error("invalid manifest: must match clarity.runtime/v1 MCPService shape");
  }
  return input;
}
