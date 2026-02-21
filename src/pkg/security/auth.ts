import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface AuthConfig {
  token?: string;
  enforceLoopbackWhenNoToken: boolean;
}

export interface AuthDecision {
  ok: boolean;
  status: 200 | 401 | 403;
  error?: string;
}

function isPrivateLoopbackAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/i, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function readAuthConfig(env = process.env): AuthConfig {
  const token = (env.CLARITYD_AUTH_TOKEN ?? env.CLARITY_API_TOKEN ?? "").trim();
  return {
    ...(token.length > 0 ? { token } : {}),
    enforceLoopbackWhenNoToken: true
  };
}

function parseBearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) return undefined;
  return match[1].trim();
}

function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function readTokenFromRequest(req: IncomingMessage, url: URL): string | undefined {
  const headerToken = parseBearerToken(
    typeof req.headers.authorization === "string" ? req.headers.authorization : undefined
  );
  if (headerToken) return headerToken;

  const xToken = req.headers["x-clarity-token"];
  if (typeof xToken === "string" && xToken.trim().length > 0) {
    return xToken.trim();
  }
  if (Array.isArray(xToken)) {
    const value = xToken.find((item) => item.trim().length > 0);
    if (value) return value.trim();
  }

  const queryToken = url.searchParams.get("token");
  if (queryToken && queryToken.trim().length > 0) {
    return queryToken.trim();
  }

  return undefined;
}

export function authorizeRequest(req: IncomingMessage, url: URL, config: AuthConfig): AuthDecision {
  if (config.token) {
    const provided = readTokenFromRequest(req, url);
    if (!provided || !secureEquals(provided, config.token)) {
      return {
        ok: false,
        status: 401,
        error: "unauthorized"
      };
    }
    return { ok: true, status: 200 };
  }

  if (!config.enforceLoopbackWhenNoToken) {
    return { ok: true, status: 200 };
  }

  const remoteAddress = req.socket.remoteAddress ?? "";
  if (!isPrivateLoopbackAddress(remoteAddress)) {
    return {
      ok: false,
      status: 403,
      error: "forbidden: configure CLARITYD_AUTH_TOKEN for non-loopback access"
    };
  }

  return { ok: true, status: 200 };
}
