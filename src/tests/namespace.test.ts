import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNamespace } from "../pkg/security/namespace.js";

test("normalizeNamespace strips unsupported characters", () => {
  const out = normalizeNamespace("My Module/Name!");
  assert.equal(out, "my_module_name");
});

test("normalizeNamespace falls back when empty", () => {
  const out = normalizeNamespace("  ");
  assert.equal(out, "service");
});
