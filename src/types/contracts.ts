export type ServiceOriginType = "local_wasm" | "remote_mcp";

export type LifecycleState =
  | "REGISTERED"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "CRASHED"
  | "QUARANTINED";

export type HealthState =
  | "UNKNOWN"
  | "HEALTHY"
  | "DEGRADED"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "UNREACHABLE";

export interface ManifestMetadata {
  serviceId?: string;
  displayName?: string;
  sourceFile: string;
  workspaceRoot?: string;
  module: string;
  version?: string;
  artifactSha256?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocalWasmOrigin {
  type: "local_wasm";
  wasmPath: string;
  entry: string;
  args?: string[];
  env?: Array<{ name: string; value?: string; secretRef?: string }>;
}

export interface RemoteMcpOrigin {
  type: "remote_mcp";
  endpoint: string;
  transport: "streamable_http" | "sse_http";
  authRef?: string;
  timeoutMs?: number;
  allowedTools?: string[];
}

export interface RestartPolicy {
  mode: "never" | "on-failure" | "always";
  maxRestarts: number;
  windowSeconds: number;
}

export interface ServiceSpec {
  origin: LocalWasmOrigin | RemoteMcpOrigin;
  enabled: boolean;
  autostart: boolean;
  restartPolicy: RestartPolicy;
  policyRef: string;
  toolNamespace?: string;
}

export interface MCPServiceManifest {
  apiVersion: "clarity.runtime/v1";
  kind: "MCPService";
  metadata: ManifestMetadata;
  spec: ServiceSpec;
}

export interface InterfaceSnapshot {
  interfaceRevision: string;
  introspectedAt: string;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  resources: Array<{ uri: string; name?: string; description?: string }>;
  prompts: Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; required?: boolean; description?: string }>;
  }>;
}

export interface ServiceRuntimeState {
  lifecycle: LifecycleState;
  health: HealthState;
  enabled: boolean;
  autostart: boolean;
  pid?: number;
  uptimeSeconds: number;
  restartCount: number;
  lastError?: string;
  lastHeartbeatAt?: string;
}

export interface ServiceRecord {
  manifest: MCPServiceManifest;
  runtime: ServiceRuntimeState;
  interfaceSnapshot?: InterfaceSnapshot;
}

export interface RegistryFile {
  version: 1;
  updatedAt: string;
  services: ServiceRecord[];
}
