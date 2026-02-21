import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolveRemoteAuthHeaders } from "../pkg/security/remote-auth.js";

test("resolveRemoteAuthHeaders supports legacy env authRef", async () => {
  const headers = await resolveRemoteAuthHeaders("my-api", {
    env: {
      CLARITY_REMOTE_AUTH_MY_API: "abc123"
    }
  });

  assert.deepEqual(headers, {
    Authorization: "Bearer abc123"
  });
});

test("resolveRemoteAuthHeaders supports env provider", async () => {
  const headers = await resolveRemoteAuthHeaders("env:REMOTE_TOKEN", {
    env: {
      REMOTE_TOKEN: "Bearer fixed-token"
    }
  });

  assert.deepEqual(headers, {
    Authorization: "Bearer fixed-token"
  });
});

test("resolveRemoteAuthHeaders supports header_env provider", async () => {
  const headers = await resolveRemoteAuthHeaders("header_env:X-API-Key:REMOTE_API_KEY", {
    env: {
      REMOTE_API_KEY: "key-123"
    }
  });

  assert.deepEqual(headers, {
    "X-API-Key": "key-123"
  });
});

test("resolveRemoteAuthHeaders supports file provider within configured root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-auth-"));
  const secretDir = path.join(root, "remote");
  const secretFile = path.join(secretDir, "svc.token");
  await mkdir(secretDir, { recursive: true });
  await writeFile(secretFile, "file-secret\n", "utf8");

  try {
    const headers = await resolveRemoteAuthHeaders("file:remote/svc.token", {
      env: {
        CLARITY_REMOTE_AUTH_FILE_ROOT: root
      },
      cwd: root
    });

    assert.deepEqual(headers, {
      Authorization: "Bearer file-secret"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveRemoteAuthHeaders blocks file traversal outside configured root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-auth-root-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "clarity-auth-outside-"));
  const outsideFile = path.join(outsideRoot, "secret.token");
  await writeFile(outsideFile, "leak\n", "utf8");

  try {
    await assert.rejects(
      () =>
        resolveRemoteAuthHeaders(`file:${path.join("..", path.basename(outsideRoot), "secret.token")}`, {
          env: {
            CLARITY_REMOTE_AUTH_FILE_ROOT: root
          },
          cwd: root
        }),
      /must stay inside CLARITY_REMOTE_AUTH_FILE_ROOT/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
