import path from "node:path";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";

const KNOWN_PROVIDERS = new Set(["legacy_env", "env", "file", "header_env"] as const);
const MAX_SECRET_LIST_ITEMS = 500;

export type RemoteAuthProvider = "legacy_env" | "env" | "file" | "header_env";

export interface ParsedRemoteAuthRef {
  provider: RemoteAuthProvider;
  target: string;
}

export interface ResolveRemoteAuthOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface RemoteAuthValidation {
  authRef: string;
  provider: RemoteAuthProvider;
  target: string;
  redactedTarget: string;
  valid: boolean;
  issues: string[];
  headerKeys: string[];
  source: "environment" | "file";
}

export interface RemoteAuthSecretWriteResult {
  authRef: string;
  provider: "file";
  path: string;
  written: true;
}

export interface RemoteAuthSecretDeleteResult {
  authRef: string;
  provider: "file";
  path: string;
  deleted: boolean;
}

export interface RemoteAuthFileSecretEntry {
  authRef: string;
  relativePath: string;
}

export interface RemoteAuthProviderHealth {
  providers: Array<{ name: RemoteAuthProvider; supported: true }>;
  fileRoot: string;
  fileRootExists: boolean;
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

export function parseRemoteAuthRef(authRef: string): ParsedRemoteAuthRef {
  const trimmed = ensureNonEmpty(authRef, "authRef");
  const splitIndex = trimmed.indexOf(":");
  if (splitIndex > 0) {
    const maybeProvider = trimmed.slice(0, splitIndex).toLowerCase();
    if (KNOWN_PROVIDERS.has(maybeProvider as RemoteAuthProvider)) {
      const target = ensureNonEmpty(trimmed.slice(splitIndex + 1), `authRef target for provider '${maybeProvider}'`);
      return { provider: maybeProvider as RemoteAuthProvider, target };
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

function resolveFileRoot(options: Required<ResolveRemoteAuthOptions>): string {
  return path.resolve(
    (options.env.CLARITY_REMOTE_AUTH_FILE_ROOT ?? "").trim() || path.join(options.cwd, ".clarity", "secrets")
  );
}

function resolveFileTargetPath(target: string, options: Required<ResolveRemoteAuthOptions>): { fileRoot: string; candidate: string } {
  const fileRoot = resolveFileRoot(options);
  const candidate = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(fileRoot, target);

  if (!isSubPath(fileRoot, candidate)) {
    throw new Error(`file authRef path must stay inside CLARITY_REMOTE_AUTH_FILE_ROOT (${fileRoot})`);
  }

  return { fileRoot, candidate };
}

async function readFileSecret(target: string, options: Required<ResolveRemoteAuthOptions>): Promise<string> {
  const { candidate } = resolveFileTargetPath(target, options);
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

function redactTarget(provider: RemoteAuthProvider, target: string): string {
  if (!target) {
    return "";
  }
  if (provider === "file") {
    const base = path.basename(target);
    return `.../${base}`;
  }
  if (provider === "header_env") {
    const firstColon = target.indexOf(":");
    if (firstColon <= 0) {
      return "***";
    }
    const headerName = target.slice(0, firstColon);
    return `${headerName}:***`;
  }
  if (target.length <= 4) {
    return "***";
  }
  return `${target.slice(0, 2)}***${target.slice(-2)}`;
}

function uniqueSorted<T>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

export async function resolveRemoteAuthHeaders(authRef: string, input: ResolveRemoteAuthOptions = {}): Promise<Record<string, string>> {
  const options: Required<ResolveRemoteAuthOptions> = {
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd()
  };

  const parsed = parseRemoteAuthRef(authRef);

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

export async function validateRemoteAuthRef(authRef: string, input: ResolveRemoteAuthOptions = {}): Promise<RemoteAuthValidation> {
  const options: Required<ResolveRemoteAuthOptions> = {
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd()
  };
  const parsed = parseRemoteAuthRef(authRef);
  const issues: string[] = [];

  try {
    await resolveRemoteAuthHeaders(authRef, options);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let headerKeys: string[] = [];
  if (issues.length === 0) {
    try {
      headerKeys = uniqueSorted(Object.keys(await resolveRemoteAuthHeaders(authRef, options)));
    } catch {
      headerKeys = [];
    }
  }

  return {
    authRef,
    provider: parsed.provider,
    target: parsed.target,
    redactedTarget: redactTarget(parsed.provider, parsed.target),
    valid: issues.length === 0,
    issues,
    headerKeys,
    source: parsed.provider === "file" ? "file" : "environment"
  };
}

export async function upsertRemoteAuthSecret(
  authRef: string,
  secret: string,
  input: ResolveRemoteAuthOptions = {}
): Promise<RemoteAuthSecretWriteResult> {
  const options: Required<ResolveRemoteAuthOptions> = {
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd()
  };
  const parsed = parseRemoteAuthRef(authRef);
  if (parsed.provider !== "file") {
    throw new Error(`secret rotation only supports file authRef values (received provider '${parsed.provider}')`);
  }

  const value = ensureNonEmpty(secret, "secret");
  const { candidate } = resolveFileTargetPath(parsed.target, options);
  await mkdir(path.dirname(candidate), { recursive: true });
  await writeFile(candidate, `${value}\n`, { encoding: "utf8", mode: 0o600 });

  return {
    authRef,
    provider: "file",
    path: candidate,
    written: true
  };
}

export async function deleteRemoteAuthSecret(authRef: string, input: ResolveRemoteAuthOptions = {}): Promise<RemoteAuthSecretDeleteResult> {
  const options: Required<ResolveRemoteAuthOptions> = {
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd()
  };
  const parsed = parseRemoteAuthRef(authRef);
  if (parsed.provider !== "file") {
    throw new Error(`secret deletion only supports file authRef values (received provider '${parsed.provider}')`);
  }

  const { candidate } = resolveFileTargetPath(parsed.target, options);
  let deleted = false;
  try {
    await unlink(candidate);
    deleted = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ENOENT/.test(message)) {
      throw error;
    }
  }

  return {
    authRef,
    provider: "file",
    path: candidate,
    deleted
  };
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (relativeDir: string): Promise<void> => {
    const absoluteDir = path.join(root, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(rel);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      out.push(rel);
      if (out.length >= MAX_SECRET_LIST_ITEMS) {
        return;
      }
    }
  };

  await walk("");
  return out;
}

export async function listRemoteAuthFileSecrets(input: ResolveRemoteAuthOptions = {}): Promise<RemoteAuthFileSecretEntry[]> {
  const options: Required<ResolveRemoteAuthOptions> = {
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd()
  };
  const root = resolveFileRoot(options);
  try {
    const relFiles = await listRelativeFiles(root);
    return relFiles
      .slice(0, MAX_SECRET_LIST_ITEMS)
      .sort((a, b) => a.localeCompare(b))
      .map((relativePath) => ({
        authRef: `file:${relativePath.replaceAll(path.sep, "/")}`,
        relativePath: relativePath.replaceAll(path.sep, "/")
      }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message)) {
      return [];
    }
    throw error;
  }
}

export async function getRemoteAuthProviderHealth(input: ResolveRemoteAuthOptions = {}): Promise<RemoteAuthProviderHealth> {
  const options: Required<ResolveRemoteAuthOptions> = {
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd()
  };
  const fileRoot = resolveFileRoot(options);
  let fileRootExists = true;
  try {
    await readdir(fileRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message)) {
      fileRootExists = false;
    } else {
      throw error;
    }
  }

  return {
    providers: [
      { name: "legacy_env", supported: true },
      { name: "env", supported: true },
      { name: "file", supported: true },
      { name: "header_env", supported: true }
    ],
    fileRoot,
    fileRootExists
  };
}
