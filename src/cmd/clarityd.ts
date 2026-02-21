#!/usr/bin/env node
import { createServer } from "node:http";
import { Command } from "commander";
import { bootstrapClaude, bootstrapCodex, bootstrapStatus } from "../pkg/bootstrap/clients.js";
import { HttpBodyError, readJsonBody } from "../pkg/http/body.js";
import { handleHttp } from "../pkg/gateway/http-api.js";
import { deriveServiceId } from "../pkg/registry/ids.js";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { validateManifest } from "../pkg/rpc/manifest.js";
import { authorizeRequest, readAuthConfig } from "../pkg/security/auth.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";

const program = new Command();

program
  .name("clarityd")
  .option("-p, --port <port>", "HTTP control plane port", "4707")
  .option("--host <host>", "HTTP control plane host", "127.0.0.1")
  .option("--auth-token <token>", "Auth token for API/MCP access (overrides CLARITYD_AUTH_TOKEN)")
  .action(async (opts) => {
    const registry = new ServiceRegistry();
    await registry.init();

    const manager = new ServiceManager(registry);
    await manager.init();
    const authConfig = readAuthConfig({
      ...process.env,
      ...(opts.authToken ? { CLARITYD_AUTH_TOKEN: String(opts.authToken) } : {})
    });

    setInterval(() => {
      manager.tickUptimes().catch((err) => {
        process.stderr.write(`uptime tick failed: ${err instanceof Error ? err.message : String(err)}\n`);
      });
    }, 1000).unref();

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      const json = (status: number, payload: unknown): void => {
        res.statusCode = status;
        if (status === 401) {
          res.setHeader("www-authenticate", "Bearer");
        }
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(`${JSON.stringify(payload, null, 2)}\n`);
      };

      if (req.method === "POST" && url.pathname === "/api/bootstrap") {
        const auth = authorizeRequest(req, url, authConfig);
        if (!auth.ok) {
          json(auth.status, { error: auth.error ?? "unauthorized" });
          return;
        }

        try {
          const parsed = await readJsonBody(req);
          const clients = Array.isArray((parsed as { clients?: unknown }).clients) ? (parsed as { clients: unknown[] }).clients : [];
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

          json(200, { results });
        } catch (error) {
          if (error instanceof HttpBodyError) {
            json(error.status, { error: error.message });
            return;
          }
          json(500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bootstrap/status") {
        const auth = authorizeRequest(req, url, authConfig);
        if (!auth.ok) {
          json(auth.status, { error: auth.error ?? "unauthorized" });
          return;
        }
        const out = await bootstrapStatus();
        json(200, out);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/services/apply") {
        const auth = authorizeRequest(req, url, authConfig);
        if (!auth.ok) {
          json(auth.status, { error: auth.error ?? "unauthorized" });
          return;
        }

        try {
          const parsed = await readJsonBody(req);

          const manifest = validateManifest((parsed as { manifest?: unknown }).manifest);
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
          json(200, { service });
        } catch (error) {
          if (error instanceof HttpBodyError) {
            json(error.status, { error: error.message });
            return;
          }
          json(500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      await handleHttp(manager, req, res, authConfig);
    });

    const port = Number(opts.port);
    const host = String(opts.host);
    server.listen(port, host, () => {
      process.stdout.write(`clarityd listening on http://${host}:${port}\n`);
      process.stdout.write(`status page: http://${host}:${port}/status\n`);
      process.stdout.write(
        authConfig.token
          ? "auth: token required (use Authorization: Bearer <token> or x-clarity-token)\n"
          : "auth: loopback-only (set CLARITYD_AUTH_TOKEN to allow secured non-loopback access)\n"
      );
    });
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
