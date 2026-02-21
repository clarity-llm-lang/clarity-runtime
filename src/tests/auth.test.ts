import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { authorizeRequest, type AuthConfig } from "../pkg/security/auth.js";

function mockRequest(input: {
  headers?: Record<string, string>;
  remoteAddress?: string;
}): IncomingMessage {
  return {
    headers: input.headers ?? {},
    socket: {
      remoteAddress: input.remoteAddress ?? "127.0.0.1"
    }
  } as unknown as IncomingMessage;
}

test("authorizeRequest accepts valid token via x-clarity-token", () => {
  const req = mockRequest({
    headers: {
      "x-clarity-token": "abc123"
    }
  });
  const decision = authorizeRequest(req, new URL("http://localhost/api/status"), {
    token: "abc123",
    enforceLoopbackWhenNoToken: true
  } satisfies AuthConfig);
  assert.equal(decision.ok, true);
});

test("authorizeRequest rejects invalid token", () => {
  const req = mockRequest({
    headers: {
      "x-clarity-token": "wrong"
    }
  });
  const decision = authorizeRequest(req, new URL("http://localhost/api/status"), {
    token: "abc123",
    enforceLoopbackWhenNoToken: true
  } satisfies AuthConfig);
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
});

test("authorizeRequest blocks non-loopback callers when token is unset", () => {
  const req = mockRequest({ remoteAddress: "192.168.1.50" });
  const decision = authorizeRequest(req, new URL("http://localhost/api/status"), {
    enforceLoopbackWhenNoToken: true
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});
