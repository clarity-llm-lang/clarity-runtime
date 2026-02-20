import type { ServiceManager } from "../supervisor/service-manager.js";
import { failure, success, type JsonRpcRequest, type JsonRpcResponse } from "./mcp-jsonrpc.js";

interface RoutedTool {
  serviceId: string;
  remoteToolName: string;
}

function namespaceFor(service: Awaited<ReturnType<ServiceManager["list"]>>[number]): string {
  return service.manifest.spec.toolNamespace ?? service.manifest.metadata.module.toLowerCase();
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

      const routed = await this.resolveTool(params.name);
      if (!routed) {
        return failure(id, -32602, `unknown tool: ${params.name}`);
      }

      try {
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

  private async aggregateTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const services = await this.runningServices();
    const out: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];

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
