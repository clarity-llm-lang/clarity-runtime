import type { ServiceManager } from "../supervisor/service-manager.js";
import { failure, success, type JsonRpcRequest, type JsonRpcResponse } from "./mcp-jsonrpc.js";

interface RoutedTool {
  serviceId: string;
  remoteToolName: string;
}

interface RuntimeToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
}

const RUNTIME_TOOLS: RuntimeToolDef[] = [
  {
    name: "runtime__status_summary",
    description: "Summarize the runtime: total/running/degraded/stopped plus local/remote counts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "runtime__list_services",
    description: "List all registered services with lifecycle, health, and interface counts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "runtime__get_service",
    description: "Get full details for a specific service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__get_logs",
    description: "Fetch recent logs for a specific service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 1000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__start_service",
    description: "Start a registered service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__stop_service",
    description: "Stop a running service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__restart_service",
    description: "Restart a service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__refresh_interface",
    description: "Refresh cached MCP interface snapshot for a service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  }
];

function namespaceFor(service: Awaited<ReturnType<ServiceManager["list"]>>[number]): string {
  return service.manifest.spec.toolNamespace ?? service.manifest.metadata.module.toLowerCase();
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as Record<string, unknown>;
}

function asString(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function asInteger(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isInteger(input)) {
    return undefined;
  }
  return input;
}

function contentJson(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function summarizeService(record: Awaited<ReturnType<ServiceManager["list"]>>[number]) {
  return {
    service_id: record.manifest.metadata.serviceId,
    display_name: record.manifest.metadata.displayName,
    source_file: record.manifest.metadata.sourceFile,
    module: record.manifest.metadata.module,
    origin_type: record.manifest.spec.origin.type,
    lifecycle: record.runtime.lifecycle,
    health: record.runtime.health,
    uptime_seconds: record.runtime.uptimeSeconds,
    restart_count: record.runtime.restartCount,
    interface: record.interfaceSnapshot
      ? {
          revision: record.interfaceSnapshot.interfaceRevision,
          introspected_at: record.interfaceSnapshot.introspectedAt,
          tools: record.interfaceSnapshot.tools.length,
          resources: record.interfaceSnapshot.resources.length,
          prompts: record.interfaceSnapshot.prompts.length
        }
      : null
  };
}

export class McpRouter {
  constructor(private readonly manager: ServiceManager) {}

  async handle(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = message.id ?? null;

    if (message.method === "initialize") {
      return success(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: "clarity-runtime",
          version: "0.1.0"
        }
      });
    }

    if (message.method === "notifications/initialized") {
      return null;
    }

    if (message.method === "ping") {
      return success(id, {});
    }

    if (message.method === "tools/list") {
      const tools = await this.aggregateTools();
      return success(id, { tools });
    }

    if (message.method === "resources/list") {
      const resources = await this.aggregateResources();
      return success(id, { resources });
    }

    if (message.method === "prompts/list") {
      const prompts = await this.aggregatePrompts();
      return success(id, { prompts });
    }

    if (message.method === "tools/call") {
      const params = (message.params ?? {}) as { name?: string; arguments?: unknown };
      if (!params.name) {
        return failure(id, -32602, "tools/call requires params.name");
      }

      try {
        if (params.name.startsWith("runtime__")) {
          const result = await this.handleRuntimeToolCall(params.name, params.arguments ?? {});
          return success(id, result);
        }

        const routed = await this.resolveTool(params.name);
        if (!routed) {
          return failure(id, -32602, `unknown tool: ${params.name}`);
        }

        const result = await this.manager.callTool(routed.serviceId, routed.remoteToolName, params.arguments ?? {});
        return success(id, result);
      } catch (error) {
        return failure(
          id,
          -32000,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return failure(id, -32601, `method not found: ${message.method}`);
  }

  private async handleRuntimeToolCall(name: string, args: unknown): Promise<unknown> {
    const payload = asObject(args);

    if (name === "runtime__status_summary") {
      const services = await this.manager.list();
      return contentJson({
        total: services.length,
        running: services.filter((s) => s.runtime.lifecycle === "RUNNING").length,
        degraded: services.filter((s) => s.runtime.health === "DEGRADED").length,
        stopped: services.filter((s) => s.runtime.lifecycle === "STOPPED" || s.runtime.lifecycle === "REGISTERED").length,
        local: services.filter((s) => s.manifest.spec.origin.type === "local_wasm").length,
        remote: services.filter((s) => s.manifest.spec.origin.type === "remote_mcp").length
      });
    }

    if (name === "runtime__list_services") {
      const services = await this.manager.list();
      return contentJson({
        services: services.map(summarizeService)
      });
    }

    if (name === "runtime__get_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__get_service requires service_id");
      const service = await this.manager.get(serviceId);
      if (!service) throw new Error(`service not found: ${serviceId}`);
      return contentJson({ service });
    }

    if (name === "runtime__get_logs") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__get_logs requires service_id");
      const limit = asInteger(payload.limit) ?? 200;
      return contentJson({
        service_id: serviceId,
        lines: await this.manager.tailLogs(serviceId, limit)
      });
    }

    if (name === "runtime__start_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__start_service requires service_id");
      const service = await this.manager.start(serviceId);
      return contentJson({ service: summarizeService(service) });
    }

    if (name === "runtime__stop_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__stop_service requires service_id");
      const service = await this.manager.stop(serviceId);
      return contentJson({ service: summarizeService(service) });
    }

    if (name === "runtime__restart_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__restart_service requires service_id");
      const service = await this.manager.restart(serviceId);
      return contentJson({ service: summarizeService(service) });
    }

    if (name === "runtime__refresh_interface") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__refresh_interface requires service_id");
      const snapshot = await this.manager.refreshInterface(serviceId);
      return contentJson({
        service_id: serviceId,
        interface: snapshot
      });
    }

    throw new Error(`unknown runtime tool: ${name}`);
  }

  private async aggregateTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const services = await this.runningServices();
    const out: Array<{ name: string; description?: string; inputSchema?: unknown }> = [...RUNTIME_TOOLS];

    for (const service of services) {
      const snapshot = await this.ensureInterface(service.manifest.metadata.serviceId!);
      const namespace = namespaceFor(service);
      for (const tool of snapshot.tools) {
        out.push({
          name: `${namespace}__${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema
        });
      }
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async aggregateResources(): Promise<Array<{ uri: string; name?: string; description?: string }>> {
    const services = await this.runningServices();
    const out: Array<{ uri: string; name?: string; description?: string }> = [];

    for (const service of services) {
      const snapshot = await this.ensureInterface(service.manifest.metadata.serviceId!);
      out.push(...snapshot.resources);
    }

    return out;
  }

  private async aggregatePrompts(): Promise<Array<{ name: string; description?: string; arguments?: unknown[] }>> {
    const services = await this.runningServices();
    const out: Array<{ name: string; description?: string; arguments?: unknown[] }> = [];

    for (const service of services) {
      const snapshot = await this.ensureInterface(service.manifest.metadata.serviceId!);
      const namespace = namespaceFor(service);
      for (const prompt of snapshot.prompts) {
        out.push({
          name: `${namespace}__${prompt.name}`,
          description: prompt.description,
          arguments: prompt.arguments
        });
      }
    }

    return out;
  }

  private async resolveTool(exposedName: string): Promise<RoutedTool | null> {
    const services = await this.runningServices();

    for (const service of services) {
      const serviceId = service.manifest.metadata.serviceId!;
      const namespace = namespaceFor(service);
      const snapshot = await this.ensureInterface(serviceId);

      for (const tool of snapshot.tools) {
        const candidate = `${namespace}__${tool.name}`;
        if (candidate === exposedName) {
          return {
            serviceId,
            remoteToolName: tool.name
          };
        }
      }
    }

    return null;
  }

  private async ensureInterface(serviceId: string) {
    const current = await this.manager.get(serviceId);
    if (current?.interfaceSnapshot) {
      return current.interfaceSnapshot;
    }
    return this.manager.refreshInterface(serviceId);
  }

  private async runningServices() {
    const all = await this.manager.list();
    return all.filter((s) => s.runtime.lifecycle === "RUNNING" && s.runtime.enabled);
  }
}
