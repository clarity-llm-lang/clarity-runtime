#!/usr/bin/env node
import { createServer } from "node:http";
import { Command } from "commander";
import { bootstrapClaude, bootstrapCodex } from "../pkg/bootstrap/clients.js";
import { handleHttp } from "../pkg/gateway/http-api.js";
import { deriveServiceId } from "../pkg/registry/ids.js";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { validateManifest } from "../pkg/rpc/manifest.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";

const program = new Command();

program
  .name("clarityd")
  .option("-p, --port <port>", "HTTP control plane port", "4707")
  .action(async (opts) => {
    const registry = new ServiceRegistry();
    await registry.init();

    const manager = new ServiceManager(registry);

    setInterval(() => {
      manager.tickUptimes().catch((err) => {
        process.stderr.write(`uptime tick failed: ${err instanceof Error ? err.message : String(err)}\n`);
      });
    }, 1000).unref();

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "POST" && url.pathname === "/api/bootstrap") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const clients = Array.isArray(parsed.clients) ? parsed.clients : [];
        const command = "clarityctl";
        const args = ["gateway", "serve", "--stdio"];
        const results: Array<{ client: string; updated: boolean; path: string }> = [];

        if (clients.includes("codex")) {
          const out = await bootstrapCodex(command, args);
          results.push({ client: "codex", ...out });
        }
        if (clients.includes("claude")) {
          const out = await bootstrapClaude(command, args);
          results.push({ client: "claude", ...out });
        }

        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(`${JSON.stringify({ results }, null, 2)}\n`);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/services/apply") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

        const manifest = validateManifest(parsed.manifest);
        manifest.metadata.serviceId =
          manifest.metadata.serviceId ??
          deriveServiceId({
            sourceFile: manifest.metadata.sourceFile,
            module: manifest.metadata.module,
            artifactOrEndpoint:
              manifest.spec.origin.type === "local_wasm"
                ? manifest.spec.origin.wasmPath
                : manifest.spec.origin.endpoint
          });

        const service = await manager.applyManifest(manifest);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(`${JSON.stringify({ service }, null, 2)}\n`);
        return;
      }

      await handleHttp(manager, req, res);
    });

    const port = Number(opts.port);
    server.listen(port, "localhost", () => {
      process.stdout.write(`clarityd listening on http://localhost:${port}\n`);
      process.stdout.write(`status page: http://localhost:${port}/status\n`);
    });
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
