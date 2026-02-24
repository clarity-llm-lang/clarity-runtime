import assert from "node:assert/strict";
import test from "node:test";
import { renderStatusPage } from "../web/status-page.js";

test("status page renders split HITL workbench panes", () => {
  const html = renderStatusPage();
  assert.match(html, /HITL Workbench/);
  assert.match(html, /Run Input \(Event Stream\)/);
  assert.match(html, /Broker Queue \(Questions\/Answers\)/);
  assert.match(html, /POST \/api\/agents\/runs\/:runId\/hitl/);
  assert.match(html, /sendHitlDirectInput\(\)/);
  assert.match(html, /sendHitlBrokerAnswer\(\)/);
  assert.match(html, /cancelHitlBrokerQuestion\(\)/);
});

test("status page renders dense agent filter controls", () => {
  const html = renderStatusPage();
  assert.match(html, /Agent Filters/);
  assert.match(html, /id="agent-filter-query"/);
  assert.match(html, /id="agent-filter-status"/);
  assert.match(html, /id="agent-filter-trigger"/);
  assert.match(html, /id="agent-filter-hitl-only"/);
  assert.doesNotMatch(html, /data-op="restart"/);
});

test("status page renders capabilities tab for MCP and agent guidance", () => {
  const html = renderStatusPage();
  assert.match(html, /id="tab-guide"/);
  assert.match(html, /Capabilities/);
  assert.match(html, /id="guide-panel"/);
  assert.match(html, /id="guide-client-attachment"/);
  assert.match(html, /renderGuideMcpSection/);
  assert.match(html, /renderGuideAgentSection/);
  assert.match(html, /MCP: What You Can Do/);
  assert.match(html, /Agents: What You Can Do/);
});

test("status page embedded script remains syntactically valid javascript", () => {
  const html = renderStatusPage();
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>");
  assert.ok(start >= 0 && end > start, "script block should exist");
  const script = html.slice(start + "<script>".length, end);
  assert.doesNotThrow(() => {
    // Compile-only check to catch malformed inline script edits.
    // eslint-disable-next-line no-new-func
    new Function(script);
  });
});
