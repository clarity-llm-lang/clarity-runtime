import { createHash } from "node:crypto";

export function deriveServiceId(input: {
  sourceFile: string;
  module: string;
  artifactOrEndpoint: string;
}): string {
  const hash = createHash("sha256")
    .update(`${input.sourceFile}|${input.module}|${input.artifactOrEndpoint}`)
    .digest("hex");

  return `svc_${hash.slice(0, 12)}`;
}

export function deriveInterfaceRevision(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `iface_${hash.slice(0, 12)}`;
}
