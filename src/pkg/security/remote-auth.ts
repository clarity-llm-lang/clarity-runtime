import path from "node:path";
import { readFile } from "node:fs/promises";

const KNOWN_PROVIDERS = new Set(["legacy_env", "env", "file", "header_env"]);

export interface ResolveRemoteAuthOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function sanitizeLegacyRef(authRef: string): string {
  return authRef.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

function ensureNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return trimmed;
}

function parseAuthRef(authRef: string): { provider: string; target: string } {
  const trimmed = ensureNonEmpty(authRef, "authRef");
  const splitIndex = trimmed.indexOf(":");
  if (splitIndex > 0) {
    const maybeProvider = trimmed.slice(0, splitIndex).toLowerCase();
    if (KNOWN_PROVIDERS.has(maybeProvider)) {
      const target = ensureNonEmpty(trimmed.slice(splitIndex + 1), `authRef target for provider '${maybeProvider}'`);
      return { provider: maybeProvider, target };
    }
  }
  return {
    provider: "legacy_env",
    target: trimmed
  };
}

function readEnvValue(env: NodeJS.ProcessEnv, envKey: string): string {
  const raw = env[envKey];
  const value = raw ? raw.trim() : "";
  if (!value) {
    throw new Error(`missing remote auth secret in env '${envKey}'`);
  }
  return value;
}

function parseHeaderEnvTarget(target: string): { headerName: string; envKey: string } {
  const firstColon = target.indexOf(":");
  if (firstColon <= 0 || firstColon >= target.length - 1) {
    throw new Error("header_env authRef must be '<Header-Name>:<ENV_VAR>'");
  }

  const headerName = ensureNonEmpty(target.slice(0, firstColon), "header name");
  const envKey = ensureNonEmpty(target.slice(firstColon + 1), "header env var");
  if (!/^[A-Za-z0-9-]+$/.test(headerName)) {
    throw new Error(`invalid header name '${headerName}'`);
  }
  if (headerName.toLowerCase() === "content-type") {
    throw new Error("header_env provider cannot override content-type");
  }

  return { headerName, envKey };
}

function isSubPath(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function readFileSecret(target: string, options: Required<ResolveRemoteAuthOptions>): Promise<string> {
  const fileRoot = path.resolve(
    (options.env.CLARITY_REMOTE_AUTH_FILE_ROOT ?? "").trim() || path.join(options.cwd, ".clarity", "secrets")
  );
  const candidate = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(fileRoot, target);

  if (!isSubPath(fileRoot, candidate)) {
    throw new Error(`file authRef path must stay inside CLARITY_REMOTE_AUTH_FILE_ROOT (${fileRoot})`);
  }

  const raw = await readFile(candidate, "utf8");
  const value = raw.trim();
  if (!value) {
    throw new Error(`remote auth file is empty: ${candidate}`);
  }
  return value;
}

function toBearerHeaderValue(secret: string): string {
  return secret.startsWith("Bearer ") ? secret : `Bearer ${secret}`;
}

export async function resolveRemoteAuthHeaders(authRef: string, input: ResolveRemoteAuthOptions = {}): Promise<Record<string, string>> {
  const options: Required<ResolveRemoteAuthOptions> = {
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd()
  };

  const parsed = parseAuthRef(authRef);

  if (parsed.provider === "legacy_env") {
    const envKey = `CLARITY_REMOTE_AUTH_${sanitizeLegacyRef(parsed.target)}`;
    const secret = readEnvValue(options.env, envKey);
    return { Authorization: toBearerHeaderValue(secret) };
  }

  if (parsed.provider === "env") {
    const envKey = ensureNonEmpty(parsed.target, "env authRef variable name");
    const secret = readEnvValue(options.env, envKey);
    return { Authorization: toBearerHeaderValue(secret) };
  }

  if (parsed.provider === "file") {
    const secret = await readFileSecret(parsed.target, options);
    return { Authorization: toBearerHeaderValue(secret) };
  }

  if (parsed.provider === "header_env") {
    const { headerName, envKey } = parseHeaderEnvTarget(parsed.target);
    return { [headerName]: readEnvValue(options.env, envKey) };
  }

  throw new Error(`unsupported authRef provider: ${parsed.provider}`);
}
