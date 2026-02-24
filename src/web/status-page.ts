export function renderStatusPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png?v=1" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=1" />
  <link rel="shortcut icon" href="/favicon.ico?v=1" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=1" />
  <title>Clarity Runtime Status</title>
  <style>
    :root {
      --bg0: #0b1020;
      --bg1: #131b33;
      --bg2: #173047;
      --panel: rgba(234, 240, 248, 0.92);
      --panel-2: rgba(242, 246, 252, 0.95);
      --panel-3: rgba(248, 251, 255, 0.96);
      --line: rgba(60, 82, 112, 0.24);
      --text: #e8edf5;
      --muted: #9daec4;
      --panel-text: #1e2e46;
      --panel-muted: #4d6380;
      --accent: #6366f1;
      --accent-2: #06b6d4;
      --ok: #16a34a;
      --bad: #dc2626;
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }

    body {
      margin: 0;
      color: var(--text);
      font-family: "SF Pro Text", "Avenir Next", "Segoe UI", -apple-system, sans-serif;
      background:
        radial-gradient(circle at 86% -12%, rgba(99, 102, 241, 0.22), transparent 40%),
        radial-gradient(circle at 0% 110%, rgba(6, 182, 212, 0.18), transparent 44%),
        linear-gradient(145deg, var(--bg0), var(--bg1) 56%, var(--bg2));
      padding: 28px;
    }

    .shell { max-width: 1180px; margin: 0 auto; }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 18px;
    }

    .tabs {
      display: inline-flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    .tab {
      border: 1px solid rgba(80, 103, 138, 0.35);
      background: rgba(8, 14, 29, 0.5);
      color: var(--muted);
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .tab.active {
      background: linear-gradient(180deg, rgba(207, 231, 247, 0.98), rgba(188, 222, 240, 0.95));
      border-color: rgba(8, 143, 178, 0.44);
      color: #0f4257;
    }

    .title {
      margin: 0;
      font-size: 24px;
      font-weight: 640;
      letter-spacing: 0.2px;
    }

    .subtitle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
    }

    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      color: var(--muted);
      background: rgba(7, 12, 24, 0.55);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--ok);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 13px;
      color: var(--panel-text);
    }

    .label {
      color: var(--panel-muted);
      text-transform: uppercase;
      letter-spacing: 0.9px;
      font-size: 10px;
    }

    .value {
      margin-top: 6px;
      font-size: 24px;
      font-weight: 650;
      line-height: 1;
      color: var(--panel-text);
    }

    .table-wrap {
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: auto;
      background: var(--panel-2);
      margin-bottom: 14px;
    }

    table { width: 100%; min-width: 980px; border-collapse: collapse; }

    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      text-align: left;
      font-size: 13px;
      color: var(--panel-text);
    }

    th {
      color: var(--panel-muted);
      text-transform: uppercase;
      letter-spacing: 0.9px;
      font-size: 10px;
      font-weight: 600;
      background: rgba(223, 231, 241, 0.86);
    }

    tr:last-child td { border-bottom: none; }

    .id { color: var(--panel-muted); font-size: 12px; margin-top: 4px; }

    .badge {
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 11px;
      font-weight: 700;
      display: inline-block;
      border: 1px solid transparent;
    }

    .run { background: rgba(22, 163, 74, 0.14); color: #0f7a39; border-color: rgba(22, 163, 74, 0.35); }
    .wait { background: rgba(217, 119, 6, 0.13); color: #935608; border-color: rgba(217, 119, 6, 0.32); }
    .stop { background: rgba(71, 85, 105, 0.12); color: #465b77; border-color: rgba(71, 85, 105, 0.28); }
    .crash { background: rgba(220, 38, 38, 0.12); color: #a72525; border-color: rgba(220, 38, 38, 0.35); }
    .trigger {
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: 700;
      border: 1px solid rgba(53, 76, 116, 0.24);
      background: rgba(255, 255, 255, 0.72);
      color: #294260;
      display: inline-block;
      margin-right: 4px;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #2a4e74;
      font-size: 12px;
    }

    .btn {
      border: 1px solid rgba(53, 76, 116, 0.34);
      color: #1d2f4a;
      background: linear-gradient(180deg, rgba(245, 249, 255, 0.96), rgba(226, 235, 247, 0.94));
      border-radius: 8px;
      padding: 6px 9px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      margin: 0 4px 4px 0;
      white-space: nowrap;
    }

    .btn.secondary {
      border-color: rgba(8, 143, 178, 0.44);
      color: #0f4257;
      background: linear-gradient(180deg, rgba(193, 234, 246, 0.98), rgba(163, 221, 239, 0.94));
    }

    .btn:hover { filter: brightness(1.03); }
    .btn.ghost {
      border-color: rgba(71, 85, 105, 0.28);
      background: rgba(255, 255, 255, 0.62);
      color: #2a3d58;
    }
    .bootstrap-note {
      border: 1px solid rgba(8, 143, 178, 0.32);
      background: rgba(207, 238, 248, 0.72);
      color: #0f4257;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .bootstrap-note.warn {
      border-color: rgba(220, 38, 38, 0.3);
      background: rgba(252, 231, 231, 0.82);
      color: #922727;
    }
    .bootstrap-note.error {
      border-color: rgba(220, 38, 38, 0.3);
      background: rgba(252, 231, 231, 0.82);
      color: #922727;
    }
    .detail-row td {
      background: rgba(230, 237, 246, 0.9);
      border-top: none;
    }
    .detail-box {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 8px;
      background: var(--panel-3);
    }
    .detail-title {
      color: var(--panel-muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-size: 10px;
      margin: 0;
    }
    .detail-list {
      margin: 0;
      padding-left: 16px;
      display: grid;
      gap: 4px;
    }
    .agent-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .flow-diagram {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px;
      background: var(--panel-2);
    }
    .flow-node {
      display: inline-flex;
      align-items: center;
      border: 1px solid rgba(53, 76, 116, 0.24);
      border-radius: 999px;
      padding: 3px 9px;
      background: rgba(255, 255, 255, 0.72);
      color: var(--panel-text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      white-space: nowrap;
    }
    .flow-arrow {
      color: var(--panel-muted);
      font-size: 12px;
      font-weight: 600;
      padding: 0 2px;
    }
    .bootstrap {
      margin-top: 14px;
      margin-bottom: 14px;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .run-summary {
      display: grid;
      gap: 4px;
    }
    .hitl-cli {
      margin-bottom: 14px;
      border: 1px solid rgba(8, 143, 178, 0.35);
      background: rgba(9, 20, 38, 0.72);
      border-radius: 12px;
      padding: 12px;
      display: grid;
      gap: 8px;
    }
    .hitl-cli-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .hitl-cli-title {
      margin: 0;
      font-size: 12px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #b8d7e5;
    }
    .hitl-cli-meta {
      font-size: 11px;
      color: #95b8ca;
    }
    .hitl-cli-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .hitl-pane {
      border: 1px solid rgba(8, 143, 178, 0.28);
      border-radius: 10px;
      background: rgba(4, 14, 28, 0.62);
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .hitl-pane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .hitl-pane-title {
      margin: 0;
      font-size: 11px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #b8d7e5;
    }
    .hitl-endpoint {
      border-radius: 999px;
      border: 1px solid rgba(8, 143, 178, 0.28);
      padding: 2px 8px;
      color: #95b8ca;
      font-size: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: rgba(5, 16, 31, 0.66);
    }
    .hitl-cli-screen {
      border: 1px solid rgba(8, 143, 178, 0.28);
      background: rgba(3, 10, 20, 0.88);
      border-radius: 10px;
      padding: 10px;
      min-height: 180px;
      max-height: 360px;
      overflow: auto;
      white-space: pre-wrap;
      color: #cfe8f4;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
    }
    .hitl-cli-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .hitl-cli-mode {
      width: 160px;
      border-radius: 8px;
      border: 1px solid rgba(8, 143, 178, 0.28);
      background: rgba(233, 243, 250, 0.96);
      color: #153b52;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 8px;
    }
    .hitl-cli-key {
      width: 220px;
      border-radius: 8px;
      border: 1px solid rgba(8, 143, 178, 0.28);
      background: rgba(233, 243, 250, 0.96);
      color: #153b52;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 8px;
    }
    .hitl-cli-input {
      flex: 1;
      min-width: 180px;
      border-radius: 8px;
      border: 1px solid rgba(8, 143, 178, 0.28);
      background: rgba(233, 243, 250, 0.96);
      color: #153b52;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 8px;
    }
    .hitl-cli-hint {
      color: #8eb2c6;
      font-size: 11px;
      margin: 0;
    }

    .audit {
      max-height: 280px;
      overflow: auto;
    }

    .audit-title {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--panel-muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .audit-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }

    .audit-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--panel-3);
      font-size: 12px;
    }

    .audit-meta {
      color: var(--panel-muted);
      font-size: 11px;
      margin-bottom: 3px;
    }

    .audit-msg {
      color: var(--panel-text);
      word-break: break-word;
    }
    .guide-grid {
      display: grid;
      gap: 10px;
      margin-bottom: 12px;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .guide-title {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--panel-muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }
    .guide-list {
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 4px;
      color: var(--panel-text);
      font-size: 12px;
    }
    .guide-services {
      display: grid;
      gap: 8px;
    }
    .guide-service-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--panel-3);
      font-size: 12px;
      color: var(--panel-text);
    }
    .guide-service-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .guide-meta {
      color: var(--panel-muted);
      font-size: 11px;
    }
    .guide-inline-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .guide-empty {
      color: var(--panel-muted);
      font-size: 12px;
    }

    @media (max-width: 760px) {
      body { padding: 14px; }
      .title { font-size: 20px; }
    }
    @media (max-width: 1100px) {
      .hitl-cli-grid { grid-template-columns: minmax(0, 1fr); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div>
        <h1 class="title">Clarity Runtime Control Plane</h1>
        <div class="subtitle">Operational view of registered MCP services and interfaces</div>
      </div>
      <div class="chip"><span class="dot"></span> Live</div>
    </div>

    <div class="tabs">
      <button id="tab-mcp" class="tab active" onclick="setTab('mcp')">MCP</button>
      <button id="tab-agents" class="tab" onclick="setTab('agents')">Agents</button>
      <button id="tab-guide" class="tab" onclick="setTab('guide')">Capabilities</button>
      <button id="tab-client-config" class="tab" onclick="setTab('client-config')">Client Config</button>
    </div>

    <div id="mcp-panel">
      <div class="grid" id="summary"></div>
      <div id="mcp-bootstrap-warning"></div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Origin</th>
              <th>Policy</th>
              <th>State</th>
              <th>Health</th>
              <th>Interface</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>

      <div class="card audit">
        <h2 class="audit-title">Audit Timeline</h2>
        <ul id="audit" class="audit-list"></ul>
      </div>
    </div>

    <div id="client-config-panel" style="display:none">
      <div class="card bootstrap">
        <div class="section-head">
          <h2 class="audit-title" style="margin:0">Client Bootstrap Config</h2>
          <button id="bootstrap-toggle" class="btn ghost" onclick="toggleBootstrapPanel()">Minimize</button>
        </div>
        <div id="bootstrap-body">
          <div id="bootstrap-config" class="code" style="display:grid; gap:8px; color:var(--panel-muted)">Loading bootstrap config...</div>
          <div id="bootstrap-action-msg"></div>
          <div style="margin-top:8px; display:grid; gap:8px;">
            <label class="code" for="bootstrap-transport">Transport</label>
            <select id="bootstrap-transport" class="btn secondary" onchange="onBootstrapTransportChange(true)">
              <option value="http" selected>http</option>
              <option value="stdio">stdio</option>
            </select>
            <label class="code" for="bootstrap-endpoint">HTTP Endpoint</label>
            <input id="bootstrap-endpoint" oninput="onBootstrapEndpointInput()" class="code" style="padding:8px; border:1px solid var(--line); border-radius:8px; background:var(--panel-2); color:var(--panel-text);" />
            <label class="code" for="bootstrap-update-agents" style="display:flex; gap:8px; align-items:center;">
              <input id="bootstrap-update-agents" type="checkbox" />
              Also update workspace AGENTS.md defaults (opt-in)
            </label>
            <button class="btn secondary" onclick="bootstrapClients()">Configure Codex + Claude</button>
            <button class="btn" onclick="removeBootstrapClients()">Remove Codex + Claude MCP</button>
          </div>
        </div>
      </div>
    </div>

    <div id="guide-panel" style="display:none">
      <div id="guide-overview-grid" class="grid"></div>
      <div id="guide-client-attachment" class="card" style="margin-bottom:10px"></div>
      <div class="guide-grid">
        <div id="guide-mcp-section" class="card"></div>
        <div id="guide-agent-section" class="card"></div>
      </div>
    </div>

    <div id="agents-panel" style="display:none">
      <div class="grid" id="agent-summary"></div>

      <div class="card" style="margin-bottom: 10px;">
        <div class="section-head">
          <h2 class="audit-title" style="margin:0">Agent Filters</h2>
          <div id="agent-filter-meta" class="code">All services</div>
        </div>
        <div class="hitl-cli-controls">
          <input id="agent-filter-query" class="hitl-cli-input" placeholder="Search service, run id, agent, role..." oninput="onAgentFiltersChanged()" />
          <select id="agent-filter-status" class="hitl-cli-mode" onchange="onAgentFiltersChanged()">
            <option value="all">Status: all</option>
            <option value="running">running</option>
            <option value="waiting">waiting</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
            <option value="cancelled">cancelled</option>
            <option value="queued">queued</option>
            <option value="unknown">unknown</option>
          </select>
          <select id="agent-filter-trigger" class="hitl-cli-mode" onchange="onAgentFiltersChanged()">
            <option value="all">Trigger: all</option>
            <option value="timer">timer</option>
            <option value="event">event</option>
            <option value="api">api</option>
            <option value="a2a">a2a</option>
            <option value="unknown">unknown</option>
          </select>
          <label class="code" style="display:flex; align-items:center; gap:6px;">
            <input id="agent-filter-hitl-only" type="checkbox" onchange="onAgentFiltersChanged()" />
            HITL-capable only
          </label>
          <button class="btn ghost" onclick="clearAgentFilters()">Clear</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Agent Service</th>
              <th>Origin</th>
              <th>Policy</th>
              <th>State</th>
              <th>Health</th>
              <th>Runs</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="agent-service-rows"></tbody>
        </table>
      </div>

      <div id="hitl-cli-panel" class="hitl-cli" style="display:none">
        <div class="hitl-cli-head">
          <h2 class="hitl-cli-title">HITL Workbench</h2>
          <button class="btn ghost" onclick="closeHitlCli()">Close</button>
        </div>
        <div id="hitl-cli-meta" class="hitl-cli-meta"></div>
        <div class="hitl-cli-grid">
          <div class="hitl-pane">
            <div class="hitl-pane-head">
              <h3 class="hitl-pane-title">Run Input (Event Stream)</h3>
              <span class="hitl-endpoint">POST /api/agents/runs/:runId/hitl</span>
            </div>
            <pre id="hitl-direct-screen" class="hitl-cli-screen"></pre>
            <div class="hitl-cli-controls">
              <input id="hitl-direct-input" class="hitl-cli-input" placeholder="Type operator input for this run..." />
              <button id="hitl-direct-send" class="btn secondary" onclick="sendHitlDirectInput()">Send To Run</button>
            </div>
            <p id="hitl-direct-hint" class="hitl-cli-hint">Writes <span class="code">agent.hitl_input</span> to the selected run event stream.</p>
          </div>
          <div class="hitl-pane">
            <div class="hitl-pane-head">
              <h3 class="hitl-pane-title">Broker Queue (Questions/Answers)</h3>
              <span class="hitl-endpoint">GET /questions · POST /answer · POST /cancel</span>
            </div>
            <pre id="hitl-broker-screen" class="hitl-cli-screen"></pre>
            <div class="hitl-cli-controls">
              <input id="hitl-broker-key" class="hitl-cli-key" placeholder="Question key (e.g. review-step-3)" />
              <input id="hitl-broker-input" class="hitl-cli-input" placeholder="Type response text for selected question..." />
              <button id="hitl-broker-send" class="btn secondary" onclick="sendHitlBrokerAnswer()">Answer</button>
              <button id="hitl-broker-cancel" class="btn ghost" onclick="cancelHitlBrokerQuestion()">Cancel</button>
            </div>
            <p id="hitl-broker-hint" class="hitl-cli-hint">Queue-based HITL for asynchronous question/answer flow.</p>
          </div>
        </div>
      </div>

      <div class="card audit">
        <h2 class="audit-title">Agent Timeline</h2>
        <ul id="agent-audit" class="audit-list"></ul>
      </div>
    </div>
  </div>
<script>
const expanded = {};
const detailCache = {};
const agentExpanded = {};
const agentDetailCache = {};
let latestRuntimeTools = [];
let latestClarityTools = [];
let latestServices = [];
let activeTab = 'mcp';
let bootstrapFormDirty = false;
let bootstrapFormInitialized = false;
let bootstrapActionMessage = '';
let bootstrapCollapsed = false;
let hitlSessionHistory = [];
let hitlPendingQuestions = [];
let hitlEventSource = null;
let hitlRunEvents = [];
let hitlCliState = {
  open: false,
  runId: '',
  serviceId: '',
  agent: '',
  status: '',
  supportsHitl: false,
  key: ''
};
let agentFilterState = {
  query: '',
  status: 'all',
  trigger: 'all',
  hitlOnly: false
};
const queryParams = new URLSearchParams(window.location.search);
const authToken = queryParams.get('token') || window.localStorage.getItem('clarity_auth_token');
if (authToken) {
  window.localStorage.setItem('clarity_auth_token', authToken);
}

async function call(path, method = 'GET', body = undefined) {
  const headers = { 'content-type': 'application/json' };
  if (authToken) {
    headers['x-clarity-token'] = authToken;
  }
  const res = await fetch(path, { method, headers, body });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function normalizeToolItems(raw) {
  const items = Array.isArray(raw) ? raw : [];
  return items.map((item) => {
    if (item && typeof item === 'object') {
      return {
        name: String(item.name || ''),
        description: item.description ? String(item.description) : ''
      };
    }
    return { name: String(item || ''), description: '' };
  }).filter((item) => item.name.length > 0);
}

function badge(state) {
  const cls = state === 'RUNNING'
    ? 'run'
    : state === 'WAITING'
      ? 'wait'
      : state === 'CRASHED' || state === 'QUARANTINED' || state === 'FAILED' || state === 'CANCELLED'
        ? 'crash'
        : 'stop';
  return '<span class="badge ' + cls + '">' + esc(state) + '</span>';
}

function normalizeTrigger(value) {
  const trigger = String(value || '').trim().toLowerCase();
  if (trigger === 'timer' || trigger === 'event' || trigger === 'api' || trigger === 'a2a') {
    return trigger;
  }
  return 'unknown';
}

function isTerminalRunStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function triggerBadge(value) {
  const trigger = normalizeTrigger(value);
  return '<span class="trigger">' + esc(trigger) + '</span>';
}

function summaryCards(data) {
  const s = data.summary;
  const systemServices = typeof data.systemServiceCount === 'number' ? data.systemServiceCount : 0;
  const mcpServices = typeof s.mcpServices === 'number' ? s.mcpServices : (typeof s.total === 'number' ? s.total : 0);
  const runningMcp = typeof s.runningMcp === 'number' ? s.runningMcp : (typeof s.running === 'number' ? s.running : 0);
  const totalServices = mcpServices + systemServices;
  const runningWithSystem = runningMcp + systemServices;
  return [
    ['Services', totalServices],
    ['System Services', systemServices],
    ['Running', runningWithSystem],
    ['Degraded', s.degraded],
    ['Stopped', s.stopped],
    ['Local', s.local],
    ['Remote', s.remote]
  ].map(([k, v]) => '<div class="card"><div class="label">' + k + '</div><div class="value">' + v + '</div></div>').join('');
}

function agentSummaryCards(summary) {
  const s = summary || {};
  return [
    ['Agent Services', Number(s.agentServices || 0)],
    ['Runs', Number(s.totalRuns || 0)],
    ['Running', Number(s.running || 0)],
    ['Waiting', Number(s.waiting || 0)],
    ['Completed', Number(s.completed || 0)],
    ['Failed', Number(s.failed || 0)],
    ['Cancelled', Number(s.cancelled || 0)]
  ].map(([k, v]) => '<div class="card"><div class="label">' + k + '</div><div class="value">' + v + '</div></div>').join('');
}

function setTab(tab) {
  activeTab = tab === 'agents' || tab === 'client-config' || tab === 'guide' ? tab : 'mcp';
  const mcpPanel = document.getElementById('mcp-panel');
  const agentsPanel = document.getElementById('agents-panel');
  const guidePanel = document.getElementById('guide-panel');
  const clientConfigPanel = document.getElementById('client-config-panel');
  const mcpTab = document.getElementById('tab-mcp');
  const agentsTab = document.getElementById('tab-agents');
  const guideTab = document.getElementById('tab-guide');
  const clientConfigTab = document.getElementById('tab-client-config');
  if (!mcpPanel || !agentsPanel || !guidePanel || !clientConfigPanel || !mcpTab || !agentsTab || !guideTab || !clientConfigTab) return;
  mcpPanel.style.display = activeTab === 'mcp' ? '' : 'none';
  agentsPanel.style.display = activeTab === 'agents' ? '' : 'none';
  guidePanel.style.display = activeTab === 'guide' ? '' : 'none';
  clientConfigPanel.style.display = activeTab === 'client-config' ? '' : 'none';
  mcpTab.classList.toggle('active', activeTab === 'mcp');
  agentsTab.classList.toggle('active', activeTab === 'agents');
  guideTab.classList.toggle('active', activeTab === 'guide');
  clientConfigTab.classList.toggle('active', activeTab === 'client-config');
}

function setBootstrapCollapsed(collapsed) {
  bootstrapCollapsed = !!collapsed;
  const body = document.getElementById('bootstrap-body');
  const toggle = document.getElementById('bootstrap-toggle');
  if (body) {
    body.style.display = bootstrapCollapsed ? 'none' : '';
  }
  if (toggle) {
    toggle.textContent = bootstrapCollapsed ? 'Expand' : 'Minimize';
  }
}

function toggleBootstrapPanel() {
  setBootstrapCollapsed(!bootstrapCollapsed);
}

async function action(id, op) {
  await call('/api/services/' + encodeURIComponent(id) + '/' + op, 'POST');
  await refresh();
}

async function bootstrapClients() {
  try {
    const transportEl = document.getElementById('bootstrap-transport');
    const endpointEl = document.getElementById('bootstrap-endpoint');
    const updateAgentsEl = document.getElementById('bootstrap-update-agents');
    const transport = transportEl && transportEl.value === 'stdio' ? 'stdio' : 'http';
    const endpoint = endpointEl && typeof endpointEl.value === 'string'
      ? endpointEl.value.trim()
      : '';
    const updateAgentsMd = !!(updateAgentsEl && updateAgentsEl.checked);
    const result = await call('/api/bootstrap', 'POST', JSON.stringify({
      clients: ['codex', 'claude'],
      transport,
      ...(updateAgentsMd ? { update_agents_md: true } : {}),
      ...(transport === 'http' && endpoint ? { endpoint } : {})
    }));
    bootstrapActionMessage = '<div class="bootstrap-note">Saved: transport=' + esc(result.transport || transport) + (result.endpoint ? ', endpoint=' + esc(result.endpoint) : '') + (result.agents_md && result.agents_md.path ? ', AGENTS.md=' + esc(result.agents_md.path) : '') + '.</div>';
    bootstrapFormDirty = false;
    bootstrapFormInitialized = true;
    await refresh();
  } catch (error) {
    bootstrapActionMessage = '<div class="bootstrap-note error">Configure failed: ' + esc(String(error)) + '</div>';
    const msgEl = document.getElementById('bootstrap-action-msg');
    if (msgEl) msgEl.innerHTML = bootstrapActionMessage;
  }
}

async function removeBootstrapClients() {
  try {
    await call('/api/bootstrap', 'DELETE', JSON.stringify({
      clients: ['codex', 'claude']
    }));
    bootstrapActionMessage = '<div class="bootstrap-note">Removed clarity_gateway from Codex and Claude.</div>';
    bootstrapFormDirty = false;
    bootstrapFormInitialized = false;
    await refresh();
  } catch (error) {
    bootstrapActionMessage = '<div class="bootstrap-note error">Remove failed: ' + esc(String(error)) + '</div>';
    const msgEl = document.getElementById('bootstrap-action-msg');
    if (msgEl) msgEl.innerHTML = bootstrapActionMessage;
  }
}

function onBootstrapTransportChange(markDirty = false) {
  const transportEl = document.getElementById('bootstrap-transport');
  const endpointEl = document.getElementById('bootstrap-endpoint');
  if (!transportEl || !endpointEl) return;
  if (markDirty) {
    bootstrapFormDirty = true;
  }
  const isHttp = transportEl.value !== 'stdio';
  endpointEl.disabled = !isHttp;
}

function onBootstrapEndpointInput() {
  bootstrapFormDirty = true;
}

function chooseBootstrapTransport(clients) {
  const list = Array.isArray(clients) ? clients : [];
  const codex = list.find((row) => row && row.client === 'codex');
  const claude = list.find((row) => row && row.client === 'claude');
  const preferred = codex && codex.configured ? codex : (claude && claude.configured ? claude : codex || claude);
  if (preferred && preferred.transport === 'stdio') return 'stdio';
  if (preferred && (preferred.transport === 'http' || preferred.endpoint)) return 'http';
  return 'http';
}

function normalizeBootstrapCfg(row) {
  if (!row) return { configured: false, transport: undefined, endpoint: '' };
  const transport = row.transport === 'stdio' ? 'stdio' : (row.transport === 'http' || row.endpoint ? 'http' : undefined);
  const endpoint = typeof row.endpoint === 'string' ? row.endpoint.trim() : '';
  return { configured: !!row.configured, transport, endpoint };
}

function buildBootstrapConsistencyNote(codexCfg, claudeCfg) {
  const codex = normalizeBootstrapCfg(codexCfg);
  const claude = normalizeBootstrapCfg(claudeCfg);
  const details = [];
  if (codex.configured !== claude.configured) {
    details.push(codex.configured ? 'Claude is not configured' : 'Codex is not configured');
  }
  if (codex.transport && claude.transport && codex.transport !== claude.transport) {
    details.push('transport differs (' + codex.transport + ' vs ' + claude.transport + ')');
  }
  if (codex.transport === 'http' && claude.transport === 'http' && codex.endpoint && claude.endpoint && codex.endpoint !== claude.endpoint) {
    details.push('HTTP endpoint differs');
  }
  if (details.length > 0) {
    return '<div class="bootstrap-note warn"><strong>Codex/Claude config mismatch:</strong> ' + esc(details.join('; ')) + '.</div>';
  }
  if (codex.configured || claude.configured) {
    return '<div class="bootstrap-note"><strong>Codex and Claude are aligned.</strong> Current transport: ' + esc(codex.transport || claude.transport || 'unknown') + '.</div>';
  }
  return '<div class="bootstrap-note">Codex and Claude are not configured yet.</div>';
}

function buildMcpBootstrapWarning(clients, statusUnavailable) {
  if (statusUnavailable) {
    return '<div class="bootstrap-note warn"><strong>Client config status unavailable:</strong> unable to check Codex/Claude MCP configuration.</div>';
  }
  const list = Array.isArray(clients) ? clients : [];
  const codexCfg = list.find((row) => row && row.client === 'codex');
  const claudeCfg = list.find((row) => row && row.client === 'claude');
  const codex = normalizeBootstrapCfg(codexCfg);
  const claude = normalizeBootstrapCfg(claudeCfg);
  const codexInstalled = !!(codexCfg && codexCfg.present);
  const claudeInstalled = !!(claudeCfg && claudeCfg.present);
  if (!codexInstalled && !claudeInstalled) {
    return '';
  }

  const details = [];
  if (codexInstalled && !codex.configured) details.push('Codex missing clarity_gateway config');
  if (claudeInstalled && !claude.configured) details.push('Claude missing clarity_gateway config');
  if (codex.configured && claude.configured) {
    if (codex.transport && claude.transport && codex.transport !== claude.transport) {
      details.push('transport mismatch between Codex and Claude');
    }
    if (codex.transport === 'http' && claude.transport === 'http' && codex.endpoint && claude.endpoint && codex.endpoint !== claude.endpoint) {
      details.push('HTTP endpoint mismatch between Codex and Claude');
    }
  }

  if (details.length === 0) {
    return '';
  }
  return '<div class="bootstrap-note warn"><strong>Client MCP configuration warning:</strong> ' + esc(details.join('; ')) + '.</div>';
}

function renderGuideOverviewCards(summarySafe, agentSummarySafe, mcpServices, agentServices, bootstrapClients) {
  const mcpToolCount = (Array.isArray(mcpServices) ? mcpServices : []).reduce((sum, svc) => {
    const iface = svc && svc.interface && typeof svc.interface === 'object' ? svc.interface : {};
    return sum + Number(iface.tools || 0);
  }, 0);
  const configuredClients = (Array.isArray(bootstrapClients) ? bootstrapClients : []).filter((row) => row && row.configured).length;
  return [
    ['MCP Services', Number((Array.isArray(mcpServices) ? mcpServices.length : 0))],
    ['Agent Services', Number((Array.isArray(agentServices) ? agentServices.length : 0))],
    ['MCP Tools Exposed', Number(mcpToolCount)],
    ['Agent Runs', Number(agentSummarySafe && agentSummarySafe.totalRuns || 0)],
    ['Waiting Runs', Number(agentSummarySafe && agentSummarySafe.waiting || 0)],
    ['LLM Clients Linked', Number(configuredClients)],
    ['Remote MCP', Number(summarySafe && summarySafe.remote || 0)],
    ['Local MCP', Number(summarySafe && summarySafe.local || 0)]
  ].map(([k, v]) => '<div class="card"><div class="label">' + k + '</div><div class="value">' + v + '</div></div>').join('');
}

function renderGuideClientAttachment(clients, statusUnavailable) {
  const list = Array.isArray(clients) ? clients : [];
  const codexCfg = list.find((row) => row && row.client === 'codex');
  const claudeCfg = list.find((row) => row && row.client === 'claude');
  const rows = [codexCfg, claudeCfg].map((row) => {
    if (!row) {
      return '<div class="guide-service-item"><div class="guide-service-head"><strong>unknown</strong><span class="guide-meta">not detected</span></div></div>';
    }
    const cfg = normalizeBootstrapCfg(row);
    const configured = row.configured ? 'configured' : 'not configured';
    const present = row.present ? 'present' : 'not installed/detected';
    const endpoint = cfg.transport === 'http' ? (cfg.endpoint || 'http endpoint not set') : 'stdio transport';
    return '<div class="guide-service-item">' +
      '<div class="guide-service-head"><strong>' + esc(String(row.client || 'client')) + '</strong><span class="guide-meta">' + esc(configured) + '</span></div>' +
      '<div class="guide-meta">install=' + esc(present) + ', transport=' + esc(cfg.transport || 'n/a') + '</div>' +
      '<div class="code">' + esc(endpoint) + '</div>' +
    '</div>';
  }).join('');

  const guidance = statusUnavailable
    ? '<div class="bootstrap-note warn"><strong>Status unavailable:</strong> unable to verify Codex/Claude MCP attachment.</div>'
    : buildBootstrapConsistencyNote(codexCfg, claudeCfg);

  return '<h2 class="guide-title">MCP Attachment To LLM Clients</h2>' +
    '<div class="guide-meta">Configured clients can call runtime MCP tools through <span class="code">clarity_gateway</span>.</div>' +
    '<div class="guide-inline-actions">' +
      '<button class="btn secondary" onclick="setTab(&quot;client-config&quot;)">Open Client Config</button>' +
      '<button class="btn ghost" onclick="setTab(&quot;mcp&quot;)">Open MCP Tab</button>' +
    '</div>' +
    guidance +
    '<div class="guide-services" style="margin-top:8px">' + rows + '</div>';
}

function renderGuideMcpSection(mcpServices, runtimeTools, clarityTools) {
  const services = Array.isArray(mcpServices) ? mcpServices : [];
  const totalResources = services.reduce((sum, svc) => sum + Number(svc && svc.interface && svc.interface.resources || 0), 0);
  const totalPrompts = services.reduce((sum, svc) => sum + Number(svc && svc.interface && svc.interface.prompts || 0), 0);
  const totalTools = services.reduce((sum, svc) => sum + Number(svc && svc.interface && svc.interface.tools || 0), 0);
  const list = services.slice(0, 14).map((svc) => {
    const iface = svc && svc.interface && typeof svc.interface === 'object' ? svc.interface : {};
    const serviceId = String(svc && svc.serviceId || '');
    return '<div class="guide-service-item">' +
      '<div class="guide-service-head"><strong>' + esc(String(svc && (svc.displayName || svc.serviceId) || 'unknown')) + '</strong>' + badge(String(svc && svc.lifecycle || 'UNKNOWN').toUpperCase()) + '</div>' +
      '<div class="guide-meta">origin=' + esc(String(svc && svc.originType || 'unknown')) + ', health=' + esc(String(svc && svc.health || 'unknown')) + '</div>' +
      '<div class="code">' + Number(iface.tools || 0) + ' tools · ' + Number(iface.resources || 0) + ' resources · ' + Number(iface.prompts || 0) + ' prompts</div>' +
      '<div class="guide-inline-actions"><button class="btn ghost" data-service-id="' + esc(serviceId) + '" onclick="openServiceDetails(this.dataset.serviceId)">Open Service</button></div>' +
    '</div>';
  }).join('');
  const empty = services.length === 0
    ? '<div class="guide-empty">No registered MCP services yet.</div>'
    : '<div class="guide-services">' + list + '</div>';

  return '<h2 class="guide-title">MCP: What You Can Do</h2>' +
    '<ul class="guide-list">' +
      '<li>Operate service lifecycle: start, stop, unquarantine, inspect details.</li>' +
      '<li>Inspect interface exposure (tools, resources, prompts) and remote policy.</li>' +
      '<li>Audit runtime operations in a single timeline.</li>' +
      '<li>Use built-in runtime tools (' + Number((runtimeTools || []).length) + ') and clarity tools (' + Number((clarityTools || []).length) + ').</li>' +
    '</ul>' +
    '<div class="guide-meta" style="margin:8px 0">Registered MCP footprint: ' + services.length + ' services · ' + totalTools + ' tools · ' + totalResources + ' resources · ' + totalPrompts + ' prompts.</div>' +
    empty;
}

function renderGuideAgentSection(agentServices, allRuns) {
  const services = Array.isArray(agentServices) ? agentServices : [];
  const runs = Array.isArray(allRuns) ? allRuns : [];
  const list = services.slice(0, 14).map((svc) => {
    const matchedRuns = runs.filter((run) => runBelongsToService(run, svc));
    const latestRun = matchedRuns.length > 0 ? matchedRuns[0] : null;
    const waitingRun = matchedRuns.find((run) => String(run && run.status || '').toLowerCase() === 'waiting') || null;
    const hitlRun = waitingRun || latestRun;
    const hitlSupported = serviceSupportsHitl(svc, matchedRuns);
    const agent = svc && svc.agent && typeof svc.agent === 'object' ? svc.agent : {};
    const triggers = Array.isArray(agent.triggers) ? agent.triggers.join(', ') : 'n/a';
    const statusBadge = latestRun ? badge(String(latestRun.status || '').toUpperCase()) : '<span class="guide-meta">no runs</span>';
    const serviceId = String(svc && svc.serviceId || '');
    const hitlAction = hitlSupported && hitlRun
      ? '<button class="btn secondary" data-run-id="' + esc(String(hitlRun.runId || '')) + '" data-service-id="' + esc(serviceId) + '" data-agent="' + esc(String(hitlRun.agent || '')) + '" data-status="' + esc(String(hitlRun.status || '')) + '" onclick="openHitlCli(this.dataset.runId,this.dataset.serviceId,this.dataset.agent,this.dataset.status,true)">Open HITL</button>'
      : '';
    return '<div class="guide-service-item">' +
      '<div class="guide-service-head"><strong>' + esc(String(svc && (svc.displayName || svc.serviceId) || 'unknown')) + '</strong>' + statusBadge + '</div>' +
      '<div class="guide-meta">role=' + esc(String(agent.role || 'unknown')) + ', triggers=' + esc(triggers) + '</div>' +
      '<div class="code">runs=' + matchedRuns.length + (latestRun ? (' · latest=' + esc(String(latestRun.runId || '')) + ' (' + esc(String(latestRun.status || 'unknown')) + ')') : '') + '</div>' +
      '<div class="guide-inline-actions">' +
        '<button class="btn ghost" data-service-id="' + esc(serviceId) + '" onclick="openServiceDetails(this.dataset.serviceId)">Open Service</button>' +
        hitlAction +
      '</div>' +
    '</div>';
  }).join('');
  const empty = services.length === 0
    ? '<div class="guide-empty">No registered Agent services yet.</div>'
    : '<div class="guide-services">' + list + '</div>';
  return '<h2 class="guide-title">Agents: What You Can Do</h2>' +
    '<ul class="guide-list">' +
      '<li>Observe runs by trigger, status, and flow/event timeline.</li>' +
      '<li>Filter agent services by query, run status, trigger, and HITL support.</li>' +
      '<li>Use HITL workbench to inject run input or answer broker queue questions.</li>' +
      '<li>Control service lifecycle and inspect dependencies/handoff topology.</li>' +
    '</ul>' +
    '<div class="guide-meta" style="margin:8px 0">Agent footprint: ' + services.length + ' services · ' + runs.length + ' recent runs.</div>' +
    empty;
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatLocalTime(value) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return esc(String(value));
  }
  return esc(date.toLocaleString());
}

function classifyServiceType(svc) {
  return svc && svc.serviceType === 'agent' ? 'agent' : 'mcp';
}

function filterRunsByTrigger(runs, filter) {
  const selected = String(filter || 'all');
  if (selected === 'all') {
    return Array.isArray(runs) ? runs : [];
  }
  return (Array.isArray(runs) ? runs : []).filter((run) => normalizeTrigger(run && run.trigger) === selected);
}

function asLower(value) {
  return String(value || '').trim().toLowerCase();
}

function readAgentFiltersFromDom() {
  const queryEl = document.getElementById('agent-filter-query');
  const statusEl = document.getElementById('agent-filter-status');
  const triggerEl = document.getElementById('agent-filter-trigger');
  const hitlOnlyEl = document.getElementById('agent-filter-hitl-only');
  agentFilterState = {
    query: queryEl && typeof queryEl.value === 'string' ? queryEl.value.trim().toLowerCase() : '',
    status: statusEl && typeof statusEl.value === 'string' ? statusEl.value : 'all',
    trigger: triggerEl && typeof triggerEl.value === 'string' ? triggerEl.value : 'all',
    hitlOnly: !!(hitlOnlyEl && hitlOnlyEl.checked)
  };
}

function onAgentFiltersChanged() {
  readAgentFiltersFromDom();
  refresh();
}

function clearAgentFilters() {
  const queryEl = document.getElementById('agent-filter-query');
  const statusEl = document.getElementById('agent-filter-status');
  const triggerEl = document.getElementById('agent-filter-trigger');
  const hitlOnlyEl = document.getElementById('agent-filter-hitl-only');
  if (queryEl && typeof queryEl.value === 'string') queryEl.value = '';
  if (statusEl && typeof statusEl.value === 'string') statusEl.value = 'all';
  if (triggerEl && typeof triggerEl.value === 'string') triggerEl.value = 'all';
  if (hitlOnlyEl) hitlOnlyEl.checked = false;
  agentFilterState = { query: '', status: 'all', trigger: 'all', hitlOnly: false };
  refresh();
}

function renderHitlHeaderMeta() {
  const metaEl = document.getElementById('hitl-cli-meta');
  if (!metaEl) return;
  const statusText = String(hitlCliState.status || '').trim();
  metaEl.innerHTML =
    '<span class="code">run=' + esc(hitlCliState.runId || 'n/a') + '</span>' +
    (hitlCliState.serviceId ? ' · <span class="code">service=' + esc(hitlCliState.serviceId) + '</span>' : '') +
    (hitlCliState.agent ? ' · <span class="code">agent=' + esc(hitlCliState.agent) + '</span>' : '') +
    ' · <span class="code">hitl=' + (hitlCliState.supportsHitl ? 'enabled' : 'disabled') + '</span>' +
    (statusText ? (' · ' + badge(statusText.toUpperCase())) : '');
}

function agentServiceMatchesFilters(svc, matchedRuns, latestRun, hitlSupported) {
  const statusFilter = String(agentFilterState.status || 'all');
  const triggerFilter = String(agentFilterState.trigger || 'all');
  if (statusFilter !== 'all') {
    const latestStatus = asLower(latestRun && latestRun.status ? latestRun.status : 'unknown');
    if (latestStatus !== statusFilter) {
      return false;
    }
  }
  if (triggerFilter !== 'all') {
    const latestTrigger = normalizeTrigger(latestRun && latestRun.trigger);
    if (latestTrigger !== triggerFilter) {
      return false;
    }
  }
  if (agentFilterState.hitlOnly && !hitlSupported) {
    return false;
  }
  const query = String(agentFilterState.query || '');
  if (!query) {
    return true;
  }
  const agentMeta = svc && svc.agent && typeof svc.agent === 'object' ? svc.agent : {};
  const haystack = [
    svc && svc.serviceId,
    svc && svc.displayName,
    svc && svc.module,
    agentMeta.agentId,
    agentMeta.name,
    agentMeta.role,
    agentMeta.objective,
    latestRun && latestRun.runId,
    latestRun && latestRun.agent,
    latestRun && latestRun.currentStepId,
    latestRun && latestRun.waitingReason,
    latestRun && latestRun.failureReason
  ].map(asLower).join(' ');
  return haystack.includes(query);
}

function findServiceForDependency(depName) {
  const needle = asLower(depName);
  if (!needle) return null;
  for (const svc of (Array.isArray(latestServices) ? latestServices : [])) {
    const candidates = [
      svc && svc.serviceId,
      svc && svc.displayName,
      svc && svc.module,
      svc && svc.agent && svc.agent.agentId,
      svc && svc.agent && svc.agent.name
    ].map(asLower).filter(Boolean);
    if (candidates.includes(needle)) {
      return svc;
    }
  }
  return null;
}

function renderDependencyStatusList(values) {
  const deps = Array.isArray(values)
    ? values.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  if (deps.length === 0) {
    return '<div class="code">No dependencies declared.</div>';
  }
  return '<ul class="detail-list">' + deps.map((dep) => {
    const service = findServiceForDependency(dep);
    if (!service) {
      return '<li class="code"><strong>' + esc(dep) + '</strong> <span class="id">not found in portal</span></li>';
    }
    const sid = String(service.serviceId || '');
    const state = String(service.lifecycle || 'UNKNOWN');
    const health = String(service.health || 'UNKNOWN');
    return '<li class="code"><strong>' + esc(dep) + '</strong> ' +
      badge(state) +
      '<span class="id"> health=' + esc(health) + ', serviceId=' + esc(sid) + '</span> ' +
      '<button class="btn ghost" data-service-id="' + esc(sid) + '" onclick="openServiceDetails(this.dataset.serviceId)">Open</button>' +
      '</li>';
  }).join('') + '</ul>';
}

async function openServiceDetails(serviceId) {
  const svc = (Array.isArray(latestServices) ? latestServices : []).find((item) => String(item && item.serviceId || '') === String(serviceId || ''));
  if (!svc) {
    return;
  }
  const tab = classifyServiceType(svc) === 'agent' ? 'agents' : 'mcp';
  setTab(tab);
  const key = 'svc__' + String(serviceId);
  expanded[key] = true;
  if (!detailCache[key]) {
    try {
      detailCache[key] = await call('/api/services/' + encodeURIComponent(serviceId) + '/details?log_limit=60&event_limit=120&call_limit=30');
    } catch (error) {
      detailCache[key] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  await refresh();
}

function serviceSupportsHitl(svc, runs) {
  const meta = svc && svc.agent && typeof svc.agent === 'object' ? svc.agent : {};
  if (meta.hitl === true || meta.humanInTheLoop === true || meta.human_in_the_loop === true) {
    return true;
  }
  const capabilities = Array.isArray(meta.capabilities) ? meta.capabilities.map((x) => String(x || '').toLowerCase()) : [];
  if (capabilities.includes('hitl') || capabilities.includes('human-in-the-loop') || capabilities.includes('human_in_the_loop')) {
    return true;
  }
  const textFields = []
    .concat(Array.isArray(meta.inputs) ? meta.inputs : [])
    .concat(Array.isArray(meta.outputs) ? meta.outputs : [])
    .concat(Array.isArray(meta.triggers) ? meta.triggers : [])
    .concat([
      typeof meta.role === 'string' ? meta.role : '',
      typeof meta.objective === 'string' ? meta.objective : ''
    ])
    .map((x) => String(x || '').toLowerCase());
  if (textFields.some((entry) => entry.includes('hitl') || entry.includes('human'))) {
    return true;
  }
  const runList = Array.isArray(runs) ? runs : [];
  return runList.some((run) => String(run && run.status || '').toLowerCase() === 'waiting');
}

function renderHitlScreen() {
  const lines = [];
  lines.push('clarity-hitl-broker virtual console');
  lines.push('pending questions: ' + hitlPendingQuestions.length);
  for (const item of hitlPendingQuestions.slice(0, 10)) {
    const key = String(item && item.key || 'unknown');
    const question = String(item && item.question || '').trim();
    const firstLine = question.split('\\n')[0] || '(empty question)';
    lines.push('[' + key + '] ' + firstLine);
  }
  const selectedKey = String(hitlCliState.key || '').trim();
  const selected = selectedKey
    ? hitlPendingQuestions.find((item) => String(item && item.key || '') === selectedKey)
    : null;
  if (selected) {
    lines.push('');
    lines.push('QUESTION (' + selectedKey + '):');
    lines.push(String(selected.question || '').trim() || '(empty question)');
  }
  if (hitlSessionHistory.length > 0) {
    lines.push('');
    lines.push('SESSION HISTORY:');
    for (const entry of hitlSessionHistory.slice(-20)) {
      lines.push(formatLocalTime(entry.at) + '  ' + entry.line);
    }
  }
  return lines.join('\\n');
}

function renderDirectCliScreen() {
  const lines = [];
  lines.push('direct virtual cli');
  lines.push('run=' + (hitlCliState.runId || 'n/a') + ', agent=' + (hitlCliState.agent || 'n/a'));
  if (hitlRunEvents.length === 0) {
    lines.push('');
    lines.push('No run events yet.');
  } else {
    lines.push('');
    for (const evt of hitlRunEvents.slice(-120)) {
      const data = evt && evt.data && typeof evt.data === 'object' ? evt.data : {};
      const at = formatLocalTime(evt && evt.at || '');
      const kind = String(evt && evt.kind || '');
      const message = typeof data.message === 'string' && data.message.trim().length > 0
        ? data.message.trim()
        : String(evt && evt.message || '');
      lines.push(at + '  ' + kind + '  ' + message);
    }
  }
  return lines.join('\\n');
}

async function inferHitlKeyFromRun(runId) {
  if (!runId) return '';
  try {
    const result = await call('/api/agents/runs/' + encodeURIComponent(runId) + '/events?limit=240');
    const events = Array.isArray(result && result.items) ? result.items : [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const evt = events[i];
      if (!evt || String(evt.kind || '') !== 'agent.waiting') continue;
      const data = evt && evt.data && typeof evt.data === 'object' ? evt.data : {};
      const candidates = [
        data.key,
        data.hitlKey,
        data.hitl_key,
        data.questionKey,
        data.question_key
      ];
      for (const value of candidates) {
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }
  } catch {
    return '';
  }
  return '';
}

async function loadHitlDirectView() {
  if (!hitlCliState.open) return;
  const screenEl = document.getElementById('hitl-direct-screen');
  const inputEl = document.getElementById('hitl-direct-input');
  const sendEl = document.getElementById('hitl-direct-send');
  const hintEl = document.getElementById('hitl-direct-hint');
  if (!screenEl || !inputEl || !sendEl || !hintEl) return;
  if (hitlCliState.runId) {
    try {
      const result = await call('/api/agents/runs/' + encodeURIComponent(hitlCliState.runId) + '/events?limit=300');
      hitlRunEvents = Array.isArray(result && result.items) ? result.items : [];
    } catch {
      hitlRunEvents = [];
    }
  } else {
    hitlRunEvents = [];
  }
  screenEl.textContent = renderDirectCliScreen();
  screenEl.scrollTop = screenEl.scrollHeight;
  renderHitlHeaderMeta();
  const allowInput = hitlCliState.supportsHitl && !!hitlCliState.runId && !isTerminalRunStatus(hitlCliState.status);
  inputEl.disabled = !allowInput;
  sendEl.disabled = inputEl.disabled;
  inputEl.placeholder = !hitlCliState.runId
    ? 'Run not available for direct input.'
    : (isTerminalRunStatus(hitlCliState.status)
      ? ('Run is ' + String(hitlCliState.status || '').toLowerCase() + '; direct HITL input is disabled.')
      : (inputEl.disabled ? 'Run not available for direct input.' : 'Type human message for the agent...'));
  hintEl.innerHTML = allowInput
    ? 'Writes <span class="code">agent.hitl_input</span> to this run timeline.'
    : 'Direct run input is unavailable for the selected run state.';
}

async function loadHitlBrokerView() {
  if (!hitlCliState.open) return;
  const screenEl = document.getElementById('hitl-broker-screen');
  const keyEl = document.getElementById('hitl-broker-key');
  const inputEl = document.getElementById('hitl-broker-input');
  const sendEl = document.getElementById('hitl-broker-send');
  const cancelEl = document.getElementById('hitl-broker-cancel');
  const hintEl = document.getElementById('hitl-broker-hint');
  if (!screenEl || !keyEl || !inputEl || !sendEl || !cancelEl || !hintEl) return;
  try {
    const result = await call('/questions');
    hitlPendingQuestions = Array.isArray(result) ? result : [];
    if (!hitlCliState.key && hitlCliState.runId) {
      const inferred = await inferHitlKeyFromRun(hitlCliState.runId);
      if (inferred) {
        hitlCliState.key = inferred;
      }
    }
    if (!hitlCliState.key && hitlPendingQuestions.length > 0) {
      hitlCliState.key = String(hitlPendingQuestions[0].key || '');
    }
    if (hitlCliState.key && !hitlPendingQuestions.some((q) => String(q && q.key || '') === hitlCliState.key)) {
      hitlCliState.key = hitlPendingQuestions.length > 0 ? String(hitlPendingQuestions[0].key || '') : '';
    }
    keyEl.value = hitlCliState.key;
    screenEl.textContent = renderHitlScreen();
    screenEl.scrollTop = screenEl.scrollHeight;
  } catch (error) {
    screenEl.textContent = 'Unable to load broker questions: ' + String(error);
  }
  renderHitlHeaderMeta();
  const allowInput = hitlCliState.supportsHitl && hitlPendingQuestions.length > 0;
  keyEl.disabled = !allowInput;
  inputEl.disabled = !allowInput;
  sendEl.disabled = !allowInput;
  cancelEl.disabled = !allowInput;
  inputEl.placeholder = allowInput
    ? 'Type response text for selected question...'
    : 'No pending HITL questions.';
  hintEl.innerHTML = 'Queue workflow: <span class="code">GET /questions</span>, <span class="code">POST /answer</span>, <span class="code">POST /cancel</span>.';
}

function startHitlEventStream() {
  if (!hitlCliState.open || hitlEventSource) return;
  const eventUrl = authToken ? '/events?token=' + encodeURIComponent(authToken) : '/events';
  try {
    hitlEventSource = new EventSource(eventUrl);
    hitlEventSource.onmessage = async (event) => {
      let payload = {};
      try {
        payload = JSON.parse(String(event.data || '{}'));
      } catch {
        payload = {};
      }
      const key = typeof payload.key === 'string' ? payload.key : '';
      const type = typeof payload.type === 'string' ? payload.type : 'event';
      hitlSessionHistory.push({
        at: new Date().toISOString(),
        line: type + (key ? ' [' + key + ']' : '')
      });
      await loadHitlBrokerView();
    };
    hitlEventSource.onerror = () => {
      if (hitlEventSource) {
        hitlEventSource.close();
        hitlEventSource = null;
      }
    };
  } catch {
    hitlEventSource = null;
  }
}

function stopHitlEventStream() {
  if (hitlEventSource) {
    hitlEventSource.close();
    hitlEventSource = null;
  }
}

async function openHitlCli(runId, serviceId, agent, status, supportsHitl) {
  hitlCliState = {
    open: true,
    runId: String(runId || '').trim(),
    serviceId: String(serviceId || '').trim(),
    agent: String(agent || '').trim(),
    status: String(status || '').trim(),
    supportsHitl: !!supportsHitl,
    key: ''
  };
  hitlSessionHistory = [];
  hitlPendingQuestions = [];
  hitlRunEvents = [];
  const panel = document.getElementById('hitl-cli-panel');
  if (panel) {
    panel.style.display = '';
  }
  stopHitlEventStream();
  startHitlEventStream();
  await Promise.all([loadHitlDirectView(), loadHitlBrokerView()]);
}

function closeHitlCli() {
  stopHitlEventStream();
  hitlCliState = {
    open: false,
    runId: '',
    serviceId: '',
    agent: '',
    status: '',
    supportsHitl: false,
    key: ''
  };
  const panel = document.getElementById('hitl-cli-panel');
  if (panel) {
    panel.style.display = 'none';
  }
}

async function sendHitlDirectInput() {
  if (!hitlCliState.open) return;
  const inputEl = document.getElementById('hitl-direct-input');
  if (!inputEl || typeof inputEl.value !== 'string' || !hitlCliState.runId) return;
  if (isTerminalRunStatus(hitlCliState.status)) return;
  const message = inputEl.value.trim();
  if (!message) return;
  await call(
    '/api/agents/runs/' + encodeURIComponent(hitlCliState.runId) + '/hitl',
    'POST',
    JSON.stringify({
      message,
      kind: 'agent.hitl_input',
      ...(hitlCliState.serviceId ? { service_id: hitlCliState.serviceId } : {}),
      ...(hitlCliState.agent ? { agent: hitlCliState.agent } : {})
    })
  );
  inputEl.value = '';
  await loadHitlDirectView();
  await refresh();
}

async function sendHitlBrokerAnswer() {
  if (!hitlCliState.open) return;
  const keyEl = document.getElementById('hitl-broker-key');
  const inputEl = document.getElementById('hitl-broker-input');
  if (!keyEl || !inputEl || typeof inputEl.value !== 'string' || typeof keyEl.value !== 'string') return;
  const key = keyEl.value.trim();
  const message = inputEl.value.trim();
  if (!key || !message) return;
  await call(
    '/answer',
    'POST',
    JSON.stringify({
      key,
      response: message
    })
  );
  hitlSessionHistory.push({
    at: new Date().toISOString(),
    line: 'answered [' + key + '] => ' + message
  });
  inputEl.value = '';
  hitlCliState.key = key;
  await loadHitlBrokerView();
  await refresh();
}

async function cancelHitlBrokerQuestion() {
  if (!hitlCliState.open) return;
  const keyEl = document.getElementById('hitl-broker-key');
  if (!keyEl || typeof keyEl.value !== 'string') return;
  const key = keyEl.value.trim();
  if (!key) return;
  await call(
    '/cancel',
    'POST',
    JSON.stringify({ key })
  );
  hitlSessionHistory.push({
    at: new Date().toISOString(),
    line: 'cancelled [' + key + ']'
  });
  hitlCliState.key = '';
  await loadHitlBrokerView();
  await refresh();
}

function renderSystemDetails(runtimeTools, clarityTools) {
  const runtimeItems = (runtimeTools || []).map((tool) => '<li class="code">' + esc(tool.name) + '</li>').join('');
  const clarityItems = (clarityTools || []).map((tool) => '<li class="code">' + esc(tool.name) + '</li>').join('');
  return '<div class="detail-box">' +
    '<h3 class="detail-title">Runtime Tool Names</h3>' +
    (runtimeItems ? '<ul class="detail-list">' + runtimeItems + '</ul>' : '<div class="code">No runtime tools reported</div>') +
    '<h3 class="detail-title">Clarity Tool Names</h3>' +
    (clarityItems ? '<ul class="detail-list">' + clarityItems + '</ul>' : '<div class="code">No clarity tools reported</div>') +
  '</div>';
}

function renderToolCatalog(title, subtitle, tools) {
  const rows = (tools || []).map((tool) => (
    '<li class="code"><strong>' + esc(tool.name) + '</strong>' +
    (tool.description ? '<div class="id">' + esc(tool.description) + '</div>' : '') +
    '</li>'
  )).join('');
  return '<div class="detail-box">' +
    '<h3 class="detail-title">' + esc(title) + '</h3>' +
    '<div class="code">' + esc(subtitle) + '</div>' +
    (rows ? '<ul class="detail-list">' + rows + '</ul>' : '<div class="code">No tools available.</div>') +
  '</div>';
}

function readTriggerContext(run, key) {
  const ctx = run && run.triggerContext && typeof run.triggerContext === 'object' ? run.triggerContext : {};
  if (ctx[key] !== undefined && ctx[key] !== null && String(ctx[key]).trim().length > 0) {
    return String(ctx[key]);
  }
  const snake = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
  if (ctx[snake] !== undefined && ctx[snake] !== null && String(ctx[snake]).trim().length > 0) {
    return String(ctx[snake]);
  }
  if (run && run[key] !== undefined && run[key] !== null && String(run[key]).trim().length > 0) {
    return String(run[key]);
  }
  return '';
}

function renderTriggerInterfaces(agent, runs) {
  const list = Array.isArray(runs) ? runs : [];
  const latestByTrigger = {};
  for (const run of list) {
    const trigger = normalizeTrigger(run && run.trigger);
    if (trigger === 'unknown') continue;
    const at = String(run && run.updatedAt || '');
    if (!latestByTrigger[trigger] || at > String(latestByTrigger[trigger].updatedAt || '')) {
      latestByTrigger[trigger] = run;
    }
  }
  const blocks = [];
  if (latestByTrigger.timer) {
    const run = latestByTrigger.timer;
    blocks.push('<div class="detail-box"><h3 class="detail-title">Timer Interface</h3>' +
      '<div class="code">Schedule regex/pattern: ' + esc(readTriggerContext(run, 'scheduleExpr') || 'n/a') + '</div>' +
      '<div class="code">scheduleId: ' + esc(readTriggerContext(run, 'scheduleId') || 'n/a') + '</div></div>');
  }
  if (latestByTrigger.api) {
    const run = latestByTrigger.api;
    blocks.push('<div class="detail-box"><h3 class="detail-title">API Interface</h3>' +
      '<div class="code">Endpoint: ' + esc(readTriggerContext(run, 'method') || 'METHOD') + ' ' + esc(readTriggerContext(run, 'route') || '/unknown') + '</div>' +
      '<div class="code">requestId: ' + esc(readTriggerContext(run, 'requestId') || 'n/a') + ', caller: ' + esc(readTriggerContext(run, 'caller') || 'n/a') + '</div></div>');
  }
  if (latestByTrigger.event) {
    const run = latestByTrigger.event;
    blocks.push('<div class="detail-box"><h3 class="detail-title">Event Interface</h3>' +
      '<div class="code">eventType: ' + esc(readTriggerContext(run, 'eventType') || 'n/a') + '</div>' +
      '<div class="code">producer: ' + esc(readTriggerContext(run, 'producer') || 'n/a') + ', eventId: ' + esc(readTriggerContext(run, 'eventId') || 'n/a') + '</div></div>');
  }
  if (latestByTrigger.a2a) {
    const run = latestByTrigger.a2a;
    blocks.push('<div class="detail-box"><h3 class="detail-title">A2A Interface</h3>' +
      '<div class="code">agentId: ' + esc((agent && agent.agentId) || 'n/a') + '</div>' +
      '<div class="code">orchestratorAgentId: ' + esc(readTriggerContext(run, 'fromAgentId') || 'n/a') + '</div>' +
      '<div class="code">orchestratorRunId: ' + esc(readTriggerContext(run, 'parentRunId') || 'n/a') + '</div>' +
      '<div class="code">handoffReason: ' + esc(readTriggerContext(run, 'handoffReason') || 'n/a') + '</div></div>');
  }
  if (blocks.length === 0) {
    return '<div class="code">No observed trigger interface data yet. Run the agent via timer/event/api/a2a to populate this section.</div>';
  }
  return '<div class="agent-meta-grid">' + blocks.join('') + '</div>';
}

function collectObservedCapabilities(runs) {
  const out = { usesMcp: false, usesLlm: false, usesA2A: false, triggers: new Set() };
  for (const run of (Array.isArray(runs) ? runs : [])) {
    const trigger = normalizeTrigger(run && run.trigger);
    if (trigger !== 'unknown') out.triggers.add(trigger);
    if (Number(run && run.toolCallCount || 0) > 0) out.usesMcp = true;
    if (Number(run && run.llmCallCount || 0) > 0) out.usesLlm = true;
    if (Number(run && run.handoffCount || 0) > 0 || trigger === 'a2a') out.usesA2A = true;
  }
  return out;
}

function renderAgentStandardFlow(agent, runs) {
  const inputs = Array.isArray(agent && agent.inputs) ? agent.inputs : [];
  const outputs = Array.isArray(agent && agent.outputs) ? agent.outputs : [];
  const deps = Array.isArray(agent && agent.dependsOn) ? agent.dependsOn : [];
  const handoffs = Array.isArray(agent && agent.handoffTargets) ? agent.handoffTargets : [];
  const observed = collectObservedCapabilities(runs);
  const triggerNodes = observed.triggers.size > 0
    ? Array.from(observed.triggers)
    : ['timer', 'event', 'api', 'a2a'];

  const nodes = [];
  nodes.push('trigger: ' + triggerNodes.join('|'));
  if (inputs.length > 0) {
    nodes.push('ingest: ' + inputs.join(', '));
  } else {
    nodes.push('ingest input');
  }
  if (agent && agent.objective) {
    nodes.push('objective: ' + agent.objective);
  }
  if (observed.usesMcp || (Array.isArray(agent && agent.allowedMcpTools) && agent.allowedMcpTools.length > 0)) {
    nodes.push('use MCP tools');
  }
  if (observed.usesLlm || (Array.isArray(agent && agent.allowedLlmProviders) && agent.allowedLlmProviders.length > 0)) {
    nodes.push('call LLM');
  }
  if (deps.length > 0) {
    nodes.push('depends on: ' + deps.join(', '));
  }
  if (observed.usesA2A || handoffs.length > 0) {
    nodes.push('A2A handoff: ' + (handoffs.length > 0 ? handoffs.join(', ') : 'other agent'));
  }
  if (outputs.length > 0) {
    nodes.push('emit: ' + outputs.join(', '));
  } else {
    nodes.push('emit result');
  }
  nodes.push('run completed|failed');

  return '<div class="flow-diagram">' +
    nodes.map((node, index) => (
      (index > 0 ? '<span class="flow-arrow">→</span>' : '') + '<span class="flow-node">' + esc(node) + '</span>'
    )).join('') +
  '</div>';
}

function renderServiceDetails(serviceId, data, agentRunsForService) {
  if (!data) {
    return '<div class="detail-box"><div class="code">Loading details...</div></div>';
  }

  if (data.error) {
    return '<div class="detail-box"><div class="code" style="color:#a72525">' + esc(data.error) + '</div></div>';
  }

  const summary = data.summary || {};
  const agent = summary && summary.agent && typeof summary.agent === 'object' ? summary.agent : null;
  const iface = data.interface || {};
  const tools = Array.isArray(iface.tools)
    ? iface.tools
      .map((tool) => ({
        name: tool && tool.name ? String(tool.name) : '',
        description: tool && tool.description ? String(tool.description) : ''
      }))
      .filter((tool) => tool.name.length > 0)
    : [];
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const calls = Array.isArray(data.recentCalls) ? data.recentCalls : [];
  const toolItems = tools.length > 0
    ? '<ul class="detail-list">' + tools.map((tool) => (
      '<li class="code"><strong>' + esc(tool.name) + '</strong>' +
      (tool.description ? '<div class="id">' + esc(tool.description) + '</div>' : '') +
      '</li>'
    )).join('') + '</ul>'
    : '<div class="code">No interface tools yet. Try Refresh Interface.</div>';
  const logItems = logs.length > 0
    ? '<ul class="detail-list">' + logs.map((line) => '<li class="code">' + esc(line) + '</li>').join('') + '</ul>'
    : '<div class="code">No recent logs.</div>';
  const callItems = calls.length > 0
    ? '<ul class="detail-list">' + calls.map((row) => '<li class="code">' + formatLocalTime(row.at) + ' ' + esc(row.message) + '</li>').join('') + '</ul>'
    : '<div class="code">No recent tool calls.</div>';
  const listOrNone = (value, fallback) => {
    const items = Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
    if (items.length === 0) {
      return '<div class="code">' + esc(fallback) + '</div>';
    }
    return '<ul class="detail-list">' + items.map((item) => '<li class="code">' + esc(item) + '</li>').join('') + '</ul>';
  };
  const declaredTriggers = Array.isArray(agent && agent.triggers)
    ? agent.triggers.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  const declaredTriggerChips = declaredTriggers.length > 0
    ? declaredTriggers.map((trigger) => '<span class="trigger">' + esc(String(trigger).toUpperCase()) + '</span>').join('')
    : '<div class="code">No triggers declared.</div>';
  const defaultTriggerFlow = '<div class="detail-box">' +
    '<h3 class="detail-title">How This Agent Can Be Triggered</h3>' +
    '<div>' + declaredTriggerChips + '</div>' +
    '<h3 class="detail-title">Standard Flow</h3>' +
    renderAgentStandardFlow(agent, agentRunsForService) +
  '</div>';
  const agentMeta = agent
    ? defaultTriggerFlow +
      '<h3 class="detail-title">Trigger Interfaces (Observed)</h3>' +
      renderTriggerInterfaces(agent, agentRunsForService) +
      '<h3 class="detail-title">Agent Metadata</h3>' +
      '<div class="code">agentId=' + esc(agent.agentId || 'unknown') + ', name=' + esc(agent.name || 'unknown') + '</div>' +
      '<div class="code">role=' + esc(agent.role || 'unknown') + ', objective=' + esc(agent.objective || 'unknown') + '</div>' +
      '<div class="agent-meta-grid">' +
        '<div><h3 class="detail-title">Inputs</h3>' + listOrNone(agent.inputs, 'No inputs declared.') + '</div>' +
        '<div><h3 class="detail-title">Outputs</h3>' + listOrNone(agent.outputs, 'No outputs declared.') + '</div>' +
        '<div><h3 class="detail-title">Dependencies</h3>' + renderDependencyStatusList(agent.dependsOn) + '</div>' +
        '<div><h3 class="detail-title">Handoff Targets</h3>' + listOrNone(agent.handoffTargets, 'No handoff targets declared.') + '</div>' +
        '<div><h3 class="detail-title">Allowed MCP Tools</h3>' + listOrNone(agent.allowedMcpTools, 'No MCP tool allowlist declared.') + '</div>' +
        '<div><h3 class="detail-title">Allowed LLM Providers</h3>' + listOrNone(agent.allowedLlmProviders, 'No LLM provider allowlist declared.') + '</div>' +
      '</div>'
    : '';

  return '<div class="detail-box">' +
    '<h3 class="detail-title">Service</h3>' +
    '<div class="code">' + esc(summary.displayName || summary.serviceId || serviceId) + '</div>' +
    '<div class="id code">' + esc(summary.serviceId || serviceId) + '</div>' +
    '<div class="id code">state=' + esc(summary.lifecycle || 'unknown') + ', health=' + esc(summary.health || 'unknown') + '</div>' +
    agentMeta +
    '<h3 class="detail-title">Interface Tools</h3>' +
    toolItems +
    '<h3 class="detail-title">Recent Tool Calls</h3>' +
    callItems +
    '<h3 class="detail-title">Recent Logs / Calls</h3>' +
    logItems +
  '</div>';
}

function renderAgentRunDetails(run, events) {
  const runId = String(run && run.runId || 'unknown');
  const lines = [];
  const flowNodes = ['run:' + runId];
  let lastNode = flowNodes[0];
  const pushNode = (candidate) => {
    if (!candidate || candidate === lastNode) return;
    flowNodes.push(candidate);
    lastNode = candidate;
  };
  for (const evt of (events || [])) {
    const data = evt && evt.data && typeof evt.data === 'object' ? evt.data : {};
    if (evt.kind === 'agent.step_started') {
      const stepId = typeof data.stepId === 'string' ? data.stepId : '';
      lines.push('START ' + (stepId || 'step'));
      pushNode('step:' + (stepId || 'step'));
    } else if (evt.kind === 'agent.tool_called') {
      const tool = typeof data.tool === 'string' ? data.tool : '';
      lines.push(' -> MCP ' + (tool || 'tool'));
      pushNode('mcp:' + (tool || 'tool'));
    } else if (evt.kind === 'agent.llm_called') {
      const provider = typeof data.provider === 'string' ? data.provider : 'llm';
      const model = typeof data.model === 'string' ? data.model : '';
      lines.push(' -> LLM ' + provider + (model ? (':' + model) : ''));
      pushNode('llm:' + provider + (model ? (':' + model) : ''));
    } else if (evt.kind === 'agent.handoff') {
      const target = typeof data.to === 'string' ? data.to : (typeof data.target === 'string' ? data.target : 'agent');
      lines.push(' -> A2A ' + target);
      pushNode('a2a:' + target);
    } else if (evt.kind === 'agent.step_completed') {
      const stepId = typeof data.stepId === 'string' ? data.stepId : '';
      lines.push('END ' + (stepId || 'step'));
      pushNode('done:' + (stepId || 'step'));
    } else if (evt.kind === 'agent.run_completed') {
      lines.push('RUN COMPLETED');
      pushNode('completed');
    } else if (evt.kind === 'agent.run_failed') {
      lines.push('RUN FAILED');
      pushNode('failed');
    }
  }
  const flowStrip = flowNodes.length > 0
    ? '<div class="flow-diagram">' + flowNodes.map((node, index) => (
      (index > 0 ? '<span class="flow-arrow">→</span>' : '') + '<span class="flow-node">' + esc(node) + '</span>'
    )).join('') + '</div>'
    : '<div class="code">No flow edges captured yet.</div>';
  const rows = (events || []).map((evt) => {
    const sid = evt.serviceId ? ' [' + esc(evt.serviceId) + ']' : '';
    return '<li class="code">' + formatLocalTime(evt.at) + ' · ' + esc(evt.kind) + sid + ' · ' + esc(evt.message) + '</li>';
  }).join('');
  const triggerContext = run && run.triggerContext && typeof run.triggerContext === 'object' ? run.triggerContext : {};
  const triggerContextEntries = Object.keys(triggerContext).sort().map((key) => (
    '<li class="code"><strong>' + esc(key) + ':</strong> ' + esc(String(triggerContext[key])) + '</li>'
  )).join('');
  const triggeredBy = '<div class="detail-box">' +
    '<h3 class="detail-title">Triggered By</h3>' +
    '<div>' + triggerBadge(run && run.trigger) + '</div>' +
    ((run && run.correlationId) ? '<div class="code">correlationId=' + esc(run.correlationId) + '</div>' : '') +
    ((run && run.causationId) ? '<div class="code">causationId=' + esc(run.causationId) + '</div>' : '') +
    ((run && run.trigger === 'a2a')
      ? '<div class="code">A2A lineage: ' + esc((run.fromAgentId || 'unknown-agent')) + (run.parentRunId ? (' (run ' + run.parentRunId + ')') : '') + ' -> ' + esc(run.agent || 'unknown-agent') + ' (run ' + esc(runId) + ')</div>'
      : '') +
    (triggerContextEntries ? '<ul class="detail-list">' + triggerContextEntries + '</ul>' : '<div class="code">No trigger context provided.</div>') +
  '</div>';
  return '<div class="detail-box">' +
    '<h3 class="detail-title">Run</h3>' +
    '<div class="code">' + esc(runId) + '</div>' +
    triggeredBy +
    '<h3 class="detail-title">Flow</h3>' +
    flowStrip +
    '<h3 class="detail-title">Flow Trace</h3>' +
    '<pre class="code" style="margin:0; white-space:pre-wrap;">' + esc(lines.join('\\n') || 'No flow edges captured yet.') + '</pre>' +
    '<h3 class="detail-title">Events</h3>' +
    (rows ? '<ul class="detail-list">' + rows + '</ul>' : '<div class="code">No events for this run.</div>') +
  '</div>';
}

function serviceAgentKeys(svc) {
  const keys = new Set();
  const push = (value) => {
    if (typeof value !== 'string') return;
    const v = value.trim().toLowerCase();
    if (v) keys.add(v);
  };
  push(svc && svc.serviceId);
  push(svc && svc.displayName);
  push(svc && svc.module);
  const agent = svc && svc.agent && typeof svc.agent === 'object' ? svc.agent : null;
  if (agent) {
    push(agent.agentId);
    push(agent.name);
  }
  return keys;
}

function runBelongsToService(run, svc) {
  if (!run || !svc) return false;
  if (run.serviceId && svc.serviceId && String(run.serviceId) === String(svc.serviceId)) {
    return true;
  }
  const keys = serviceAgentKeys(svc);
  const runAgent = String(run.agent || '').trim().toLowerCase();
  if (runAgent && keys.has(runAgent)) {
    return true;
  }
  return false;
}

function renderAgentRunsForService(svc, allRuns) {
  const matched = (Array.isArray(allRuns) ? allRuns : [])
    .filter((run) => runBelongsToService(run, svc))
    .slice(0, 12);
  const latest = matched.length > 0 ? matched[0] : null;
  const summary = matched.length > 0
    ? '<div class="code">' + matched.length + ' run(s) matched</div>' +
      '<div class="run-summary"><div>' + badge(String(latest.status || '').toUpperCase()) + ' ' + triggerBadge(latest.trigger) + '</div>' +
      '<div class="code">latest=' + esc(String(latest.runId || 'unknown')) + ' · ' + formatLocalTime(latest.updatedAt || '') + '</div></div>'
    : '<div class="code">No runs matched this service yet.</div>';
  const items = matched.map((run) => {
    const runId = String(run.runId || 'unknown');
    const key = runId;
    const status = String(run.status || 'queued').toUpperCase();
    const counters = 'steps=' + Number(run.stepCount || 0) + ', handoffs=' + Number(run.handoffCount || 0) + ', mcp=' + Number(run.toolCallCount || 0) + ', llm=' + Number(run.llmCallCount || 0) + (run.currentStepId ? ', current=' + String(run.currentStepId) : '');
    const details = agentExpanded[key]
      ? renderAgentRunDetails(run, agentDetailCache[key])
      : '';
    return '<div class="detail-box">' +
      '<div><strong class="code">' + esc(runId) + '</strong> ' + badge(status) + ' ' + triggerBadge(run.trigger) + '</div>' +
      '<div class="code">agent=' + esc(run.agent || 'unknown') + (run.serviceId ? ', service=' + esc(run.serviceId) : '') + '</div>' +
      '<div class="code">' + esc(counters) + '</div>' +
      '<div class="code">updated=' + formatLocalTime(run.updatedAt || '') + '</div>' +
      '<div><button class="btn ghost" data-run-id="' + esc(runId) + '" onclick="toggleAgentDetails(this.dataset.runId)">Details</button></div>' +
      details +
    '</div>';
  }).join('');
  return '<div class="detail-box">' +
    '<h3 class="detail-title">Recent Runs</h3>' +
    summary +
    (items || '') +
  '</div>';
}

async function toggleDetails(key, kind, serviceId) {
  expanded[key] = !expanded[key];
  if (expanded[key] && kind === 'service' && !detailCache[key]) {
    try {
      detailCache[key] = await call('/api/services/' + encodeURIComponent(serviceId) + '/details?log_limit=60&event_limit=120&call_limit=30');
    } catch (error) {
      detailCache[key] = {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  if (expanded[key] && kind === 'system') {
    detailCache[key] = {
      runtimeTools: latestRuntimeTools || [],
      clarityTools: latestClarityTools || []
    };
  }
  await refresh();
}

async function toggleAgentDetails(runId) {
  agentExpanded[runId] = !agentExpanded[runId];
  if (agentExpanded[runId] && !agentDetailCache[runId]) {
    try {
      const result = await call('/api/agents/runs/' + encodeURIComponent(runId) + '/events?limit=120');
      agentDetailCache[runId] = Array.isArray(result && result.items) ? result.items : [];
    } catch (error) {
      agentDetailCache[runId] = [{
        at: new Date().toISOString(),
        kind: 'agent.error',
        serviceId: '',
        message: error instanceof Error ? error.message : String(error)
      }];
    }
  }
  await refresh();
}

async function refresh() {
  try {
    const [statusResult, auditResult, agentRunsResult, agentEventsResult] = await Promise.allSettled([
      call('/api/status'),
      call('/api/audit?limit=25'),
      call('/api/agents/runs?limit=120'),
      call('/api/agents/events?limit=120')
    ]);
    const data = statusResult.status === 'fulfilled'
      ? statusResult.value
      : {
        summary: { total: 0, mcpServices: 0, agentServices: 0, running: 0, runningMcp: 0, runningAgent: 0, degraded: 0, stopped: 0, local: 0, remote: 0 },
        agents: { totalRuns: 0, running: 0, waiting: 0, completed: 0, failed: 0, cancelled: 0 },
        services: [],
        systemTools: {
          items: [],
          runtime: { items: [] },
          clarity: { items: [] }
        }
      };
    const audit = auditResult.status === 'fulfilled'
      ? auditResult.value
      : { items: [] };
    const agentRunsBody = agentRunsResult.status === 'fulfilled'
      ? agentRunsResult.value
      : { items: [] };
    const agentEventsBody = agentEventsResult.status === 'fulfilled'
      ? agentEventsResult.value
      : { items: [] };
    const summarySafe = (data && data.summary) ? data.summary : { total: 0, mcpServices: 0, agentServices: 0, running: 0, runningMcp: 0, runningAgent: 0, degraded: 0, stopped: 0, local: 0, remote: 0 };
    const agentSummarySafe = {
      totalRuns: Number(data && data.agents && data.agents.totalRuns || 0),
      running: Number(data && data.agents && data.agents.running || 0),
      waiting: Number(data && data.agents && data.agents.waiting || 0),
      completed: Number(data && data.agents && data.agents.completed || 0),
      failed: Number(data && data.agents && data.agents.failed || 0),
      cancelled: Number(data && data.agents && data.agents.cancelled || 0),
      agentServices: Number(summarySafe.agentServices || 0)
    };
    const services = Array.isArray(data && data.services) ? data.services : [];
    latestServices = services;
    const mcpServices = services.filter((svc) => classifyServiceType(svc) === 'mcp');
    const agentServices = services.filter((svc) => classifyServiceType(svc) === 'agent');
    const agentRuns = Array.isArray(agentRunsBody && agentRunsBody.items) ? agentRunsBody.items : [];
    const filteredAgentRuns = agentRuns;
    readAgentFiltersFromDom();
    const agentEvents = Array.isArray(agentEventsBody && agentEventsBody.items) ? agentEventsBody.items : [];
    const runtimeTools = normalizeToolItems(data && data.systemTools && data.systemTools.runtime && data.systemTools.runtime.items);
    const clarityTools = normalizeToolItems(data && data.systemTools && data.systemTools.clarity && data.systemTools.clarity.items);
    let bootstrap = { clients: [] };
    let bootstrapStatusUnavailable = false;
    try {
      bootstrap = await call('/api/bootstrap/status');
    } catch {
      bootstrap = { clients: [] };
      bootstrapStatusUnavailable = true;
    }
    latestRuntimeTools = runtimeTools;
    latestClarityTools = clarityTools;
    document.getElementById('summary').innerHTML = summaryCards({
      summary: summarySafe,
      systemServiceCount: 2
    });
    document.getElementById('agent-summary').innerHTML = agentSummaryCards(agentSummarySafe);
    const runtimeSystemRow = '<tr>' +
      '<td><strong>Runtime System</strong><div class="id code">system__runtime</div></td>' +
      '<td><span class="code">system</span></td>' +
      '<td><div class="code">built-in</div></td>' +
      '<td>' + badge('RUNNING') + '</td>' +
      '<td><span class="code">HEALTHY</span></td>' +
      '<td>' + runtimeTools.length + ' runtime tools</td>' +
      '<td>' +
        '<button class="btn ghost" data-key="system__runtime" data-kind="system" data-service="" onclick="toggleDetails(this.dataset.key,this.dataset.kind,this.dataset.service)">Details</button>' +
      '</td>' +
    '</tr>';
    const runtimeSystemDetailRow = expanded.system__runtime
      ? '<tr class="detail-row"><td colspan="7">' + renderToolCatalog('Runtime System', 'Built-in runtime control tools with descriptions.', runtimeTools) + '</td></tr>'
      : '';

    const claritySystemRow = '<tr>' +
      '<td><strong>Clarity System</strong><div class="id code">system__clarity</div></td>' +
      '<td><span class="code">system</span></td>' +
      '<td><div class="code">built-in</div></td>' +
      '<td>' + badge('RUNNING') + '</td>' +
      '<td><span class="code">HEALTHY</span></td>' +
      '<td>' + clarityTools.length + ' clarity tools</td>' +
      '<td>' +
        '<button class="btn ghost" data-key="system__clarity" data-kind="system" data-service="" onclick="toggleDetails(this.dataset.key,this.dataset.kind,this.dataset.service)">Details</button>' +
      '</td>' +
    '</tr>';
    const claritySystemDetailRow = expanded.system__clarity
      ? '<tr class="detail-row"><td colspan="7">' + renderToolCatalog('Clarity System', 'Built-in clarity-assist tools with descriptions.', clarityTools) + '</td></tr>'
      : '';

    const serviceRows = mcpServices.map((svc) => {
      const iface = svc.interface || {};
      const policy = svc.policy || {};
      const remote = policy.remote || null;
      const toolCount = typeof iface.tools === 'number' ? iface.tools : 0;
      const resCount = typeof iface.resources === 'number' ? iface.resources : 0;
      const promptCount = typeof iface.prompts === 'number' ? iface.prompts : 0;
      const restart = policy.restart
        ? policy.restart.mode + '/' + policy.restart.maxRestarts + 'x/' + policy.restart.windowSeconds + 's'
        : 'n/a';
      const remotePolicy = remote
        ? 'to=' + (remote.timeoutMs != null ? remote.timeoutMs : 'default') + 'ms, tools=' + ((remote.allowedTools || []).length > 0 ? remote.allowedTools.join(',') : '*') +
          ', payload=' + (remote.maxPayloadBytes != null ? remote.maxPayloadBytes : 'default') +
          ', conc=' + (remote.maxConcurrency != null ? remote.maxConcurrency : 'default')
        : '';
      const displayName = esc(svc.displayName || svc.serviceId);
      const serviceId = esc(svc.serviceId);
      const originType = esc(svc.originType);
      const restartLabel = esc(restart);
      const remotePolicyLabel = esc(remotePolicy);
      const healthLabel = esc(svc.health);
      const key = 'svc__' + svc.serviceId;
      const keyAttr = esc(key);
      const detailRow = expanded[key]
        ? '<tr class="detail-row"><td colspan="7">' + renderServiceDetails(svc.serviceId, detailCache[key], []) + '</td></tr>'
        : '';
      return '<tr>' +
        '<td><strong>' + displayName + '</strong><div class="id code">' + serviceId + '</div></td>' +
        '<td><span class="code">' + originType + '</span></td>' +
        '<td><div class="code">' + restartLabel + '</div>' + (remotePolicy ? '<div class="id code">' + remotePolicyLabel + '</div>' : '') + '</td>' +
        '<td>' + badge(svc.lifecycle) + '</td>' +
        '<td><span class="code">' + healthLabel + '</span></td>' +
        '<td>' + toolCount + ' tools, ' + resCount + ' resources, ' + promptCount + ' prompts</td>' +
        '<td>' +
          '<button class="btn ghost" data-key="' + keyAttr + '" data-kind="service" data-service="' + serviceId + '" onclick="toggleDetails(this.dataset.key,this.dataset.kind,this.dataset.service)">Details</button>' +
          '<button class="btn" data-service="' + serviceId + '" data-op="start" onclick="action(this.dataset.service,this.dataset.op)">Start</button>' +
          '<button class="btn" data-service="' + serviceId + '" data-op="stop" onclick="action(this.dataset.service,this.dataset.op)">Stop</button>' +
          (svc.lifecycle === 'QUARANTINED'
            ? '<button class="btn secondary" data-service="' + serviceId + '" data-op="unquarantine" onclick="action(this.dataset.service,this.dataset.op)">Unquarantine</button>'
            : '') +
        '</td>' +
      '</tr>' + detailRow;
    }).join('');
    const rows = runtimeSystemRow + runtimeSystemDetailRow + claritySystemRow + claritySystemDetailRow + serviceRows;
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="7" style="color:var(--panel-muted)">No MCP services registered</td></tr>';

    const runsByAgentServiceId = new Map();
    for (const svc of agentServices) {
      const sid = String(svc && svc.serviceId || '');
      runsByAgentServiceId.set(sid, filteredAgentRuns.filter((run) => runBelongsToService(run, svc)));
    }
    const visibleAgentServices = agentServices.filter((svc) => {
      const sid = String(svc && svc.serviceId || '');
      const matchedRuns = runsByAgentServiceId.get(sid) || [];
      const latestRun = matchedRuns.length > 0 ? matchedRuns[0] : null;
      const hitlSupported = serviceSupportsHitl(svc, matchedRuns);
      return agentServiceMatchesFilters(svc, matchedRuns, latestRun, hitlSupported);
    });
    const agentFilterMeta = document.getElementById('agent-filter-meta');
    if (agentFilterMeta) {
      const activeFilters = [];
      if (agentFilterState.query) activeFilters.push('query=' + agentFilterState.query);
      if (agentFilterState.status !== 'all') activeFilters.push('status=' + agentFilterState.status);
      if (agentFilterState.trigger !== 'all') activeFilters.push('trigger=' + agentFilterState.trigger);
      if (agentFilterState.hitlOnly) activeFilters.push('hitl=only');
      const filterLabel = activeFilters.length > 0 ? (' · ' + activeFilters.join(' · ')) : '';
      agentFilterMeta.textContent = visibleAgentServices.length + '/' + agentServices.length + ' shown' + filterLabel;
    }

    const agentServiceRows = visibleAgentServices.map((svc) => {
      const iface = svc.interface || {};
      const policy = svc.policy || {};
      const remote = policy.remote || null;
      const toolCount = typeof iface.tools === 'number' ? iface.tools : 0;
      const resCount = typeof iface.resources === 'number' ? iface.resources : 0;
      const promptCount = typeof iface.prompts === 'number' ? iface.prompts : 0;
      const restart = policy.restart
        ? policy.restart.mode + '/' + policy.restart.maxRestarts + 'x/' + policy.restart.windowSeconds + 's'
        : 'n/a';
      const remotePolicy = remote
        ? 'to=' + (remote.timeoutMs != null ? remote.timeoutMs : 'default') + 'ms, tools=' + ((remote.allowedTools || []).length > 0 ? remote.allowedTools.join(',') : '*') +
          ', payload=' + (remote.maxPayloadBytes != null ? remote.maxPayloadBytes : 'default') +
          ', conc=' + (remote.maxConcurrency != null ? remote.maxConcurrency : 'default')
        : '';
      const displayName = esc(svc.displayName || svc.serviceId);
      const serviceId = esc(svc.serviceId);
      const originType = esc(svc.originType);
      const agentMeta = svc.agent || {};
      const roleLabel = agentMeta && agentMeta.role ? String(agentMeta.role) : 'unknown-role';
      const objectiveLabel = agentMeta && agentMeta.objective ? String(agentMeta.objective) : '';
      const restartLabel = esc(restart);
      const remotePolicyLabel = esc(remotePolicy);
      const healthLabel = esc(svc.health);
      const key = 'svc__' + svc.serviceId;
      const keyAttr = esc(key);
      const matchedRuns = runsByAgentServiceId.get(String(svc.serviceId || '')) || [];
      const latestRun = matchedRuns.length > 0 ? matchedRuns[0] : null;
      const waitingRun = matchedRuns.find((run) => String(run && run.status || '').toLowerCase() === 'waiting') || null;
      const hitlRun = waitingRun || latestRun;
      const hitlSupported = serviceSupportsHitl(svc, matchedRuns);
      const hitlButton = !hitlSupported
        ? ''
        : (hitlRun
          ? '<button class="btn secondary" data-run-id="' + esc(hitlRun.runId || '') + '" data-service-id="' + serviceId + '" data-agent="' + esc(hitlRun.agent || '') + '" data-status="' + esc(hitlRun.status || '') + '" onclick="openHitlCli(this.dataset.runId,this.dataset.serviceId,this.dataset.agent,this.dataset.status,true)">HITL CLI</button>'
          : '<button class="btn ghost" disabled title="No runs available yet">HITL CLI</button>');
      const runColumn = matchedRuns.length > 0
        ? '<div class="run-summary"><div class="code">' + matchedRuns.length + ' run(s)</div><div>' + badge(String(latestRun.status || '').toUpperCase()) + ' ' + triggerBadge(latestRun.trigger) + '</div></div>'
        : '<div class="code">0 runs</div>';
      const detailRow = expanded[key]
        ? '<tr class="detail-row"><td colspan="7">' + renderServiceDetails(svc.serviceId, detailCache[key], matchedRuns) + renderAgentRunsForService(svc, filteredAgentRuns) + '</td></tr>'
        : '';
      return '<tr>' +
        '<td><strong>' + displayName + '</strong><div class="id code">' + serviceId + '</div><div class="id code">role=' + esc(roleLabel) + (objectiveLabel ? ', objective=' + esc(objectiveLabel) : '') + '</div></td>' +
        '<td><span class="code">' + originType + '</span></td>' +
        '<td><div class="code">' + restartLabel + '</div>' + (remotePolicy ? '<div class="id code">' + remotePolicyLabel + '</div>' : '') + '</td>' +
        '<td>' + badge(svc.lifecycle) + '</td>' +
        '<td><span class="code">' + healthLabel + '</span></td>' +
        '<td>' + runColumn + '</td>' +
        '<td>' +
          '<button class="btn ghost" data-key="' + keyAttr + '" data-kind="service" data-service="' + serviceId + '" onclick="toggleDetails(this.dataset.key,this.dataset.kind,this.dataset.service)">Details</button>' +
          '<button class="btn" data-service="' + serviceId + '" data-op="start" onclick="action(this.dataset.service,this.dataset.op)">Start</button>' +
          '<button class="btn" data-service="' + serviceId + '" data-op="stop" onclick="action(this.dataset.service,this.dataset.op)">Stop</button>' +
          hitlButton +
          (svc.lifecycle === 'QUARANTINED'
            ? '<button class="btn secondary" data-service="' + serviceId + '" data-op="unquarantine" onclick="action(this.dataset.service,this.dataset.op)">Unquarantine</button>'
            : '') +
        '</td>' +
      '</tr>' + detailRow;
    }).join('');
    document.getElementById('agent-service-rows').innerHTML = agentServiceRows || (
      agentServices.length > 0
        ? '<tr><td colspan="7" style="color:var(--panel-muted)">No agent services match current filters</td></tr>'
        : '<tr><td colspan="7" style="color:var(--panel-muted)">No agent services registered</td></tr>'
    );
    if (hitlCliState.open && hitlCliState.runId) {
      const liveRun = filteredAgentRuns.find((run) => String(run && run.runId || '') === hitlCliState.runId) || null;
      if (liveRun) {
        hitlCliState.status = String(liveRun.status || hitlCliState.status || '');
        hitlCliState.agent = String(liveRun.agent || hitlCliState.agent || '');
        if (!hitlCliState.serviceId && liveRun.serviceId) {
          hitlCliState.serviceId = String(liveRun.serviceId);
        }
      }
      await Promise.all([loadHitlDirectView(), loadHitlBrokerView()]);
    } else if (hitlCliState.open) {
      await Promise.all([loadHitlDirectView(), loadHitlBrokerView()]);
    }

    const bootstrapClients = Array.isArray(bootstrap && bootstrap.clients) ? bootstrap.clients : [];
    const bootstrapTransportEl = document.getElementById('bootstrap-transport');
    const bootstrapEndpointEl = document.getElementById('bootstrap-endpoint');
    if (bootstrapEndpointEl && !bootstrapEndpointEl.value) {
      bootstrapEndpointEl.value = window.location.origin + '/mcp';
    }
    const bootstrapRows = bootstrapClients.map((row) => {
      const configured = row && row.configured ? 'configured' : 'missing';
      const transport = row && row.transport ? row.transport : (row && row.endpoint ? 'http' : 'stdio');
      const endpoint = row && row.endpoint ? row.endpoint : '';
      const cmd = row && row.command ? row.command : 'n/a';
      const args = row && Array.isArray(row.args) && row.args.length > 0 ? row.args.join(' ') : '';
      return '<div class="detail-box">' +
        '<div><strong>' + esc(row.client || 'unknown') + '</strong> <span class="id code">(' + configured + ')</span></div>' +
        '<div class="code">' + esc(row.path || '') + '</div>' +
        '<div class="code">transport: ' + esc(transport) + '</div>' +
        (endpoint ? '<div class="code">url: ' + esc(endpoint) + '</div>' : '') +
        '<div class="code">command: ' + esc(cmd + (args ? ' ' + args : '')) + '</div>' +
      '</div>';
    }).join('');
    const codexCfg = bootstrapClients.find((row) => row && row.client === 'codex');
    const claudeCfg = bootstrapClients.find((row) => row && row.client === 'claude');
    const mcpBootstrapWarning = buildMcpBootstrapWarning(bootstrapClients, bootstrapStatusUnavailable);
    document.getElementById('mcp-bootstrap-warning').innerHTML = mcpBootstrapWarning;
    const selectedTransport = chooseBootstrapTransport(bootstrapClients);
    const activeCfg = codexCfg || bootstrapClients.find((row) => row && row.client === 'claude');
    if (bootstrapTransportEl && (!bootstrapFormDirty || !bootstrapFormInitialized)) {
      bootstrapTransportEl.value = selectedTransport;
    }
    if (bootstrapEndpointEl && (!bootstrapFormDirty || !bootstrapFormInitialized)) {
      if (activeCfg && activeCfg.endpoint) {
        bootstrapEndpointEl.value = activeCfg.endpoint;
      } else if (!bootstrapEndpointEl.value) {
        bootstrapEndpointEl.value = window.location.origin + '/mcp';
      }
    }
    bootstrapFormInitialized = true;
    onBootstrapTransportChange(false);
    document.getElementById('bootstrap-action-msg').innerHTML = bootstrapActionMessage;
    document.getElementById('bootstrap-config').innerHTML = buildBootstrapConsistencyNote(codexCfg, claudeCfg) + (bootstrapRows || '<div class="code">Bootstrap status unavailable.</div>');
    document.getElementById('guide-overview-grid').innerHTML = renderGuideOverviewCards(summarySafe, agentSummarySafe, mcpServices, agentServices, bootstrapClients);
    document.getElementById('guide-client-attachment').innerHTML = renderGuideClientAttachment(bootstrapClients, bootstrapStatusUnavailable);
    document.getElementById('guide-mcp-section').innerHTML = renderGuideMcpSection(mcpServices, runtimeTools, clarityTools);
    document.getElementById('guide-agent-section').innerHTML = renderGuideAgentSection(agentServices, filteredAgentRuns);

    const auditItems = Array.isArray(audit && audit.items) ? audit.items : [];
    const auditRows = auditItems.slice().reverse().map((evt) => {
      const sid = evt.serviceId ? ' [' + esc(evt.serviceId) + ']' : '';
      return '<li class="audit-item">' +
        '<div class="audit-meta">' + formatLocalTime(evt.at) + ' · ' + esc(evt.kind) + sid + '</div>' +
        '<div class="audit-msg">' + esc(evt.message) + '</div>' +
      '</li>';
    }).join('');
    const auditFallback = statusResult.status === 'rejected'
      ? 'Status endpoint unavailable'
      : (auditResult.status === 'rejected' ? 'Audit endpoint unavailable' : 'No events yet');
    document.getElementById('audit').innerHTML = auditRows || '<li class="audit-item"><div class="audit-msg" style="color:var(--panel-muted)">' + auditFallback + '</div></li>';

    const agentAuditRows = agentEvents.slice().reverse().map((evt) => {
      const runId = evt && evt.data && typeof evt.data.runId === 'string' ? ' [' + esc(evt.data.runId) + ']' : '';
      return '<li class="audit-item">' +
        '<div class="audit-meta">' + formatLocalTime(evt.at) + ' · ' + esc(evt.kind) + runId + '</div>' +
        '<div class="audit-msg">' + esc(evt.message || '') + '</div>' +
      '</li>';
    }).join('');
    const agentAuditFallback = agentEventsResult.status === 'rejected' ? 'Agent endpoint unavailable' : 'No agent events yet';
    document.getElementById('agent-audit').innerHTML = agentAuditRows || '<li class="audit-item"><div class="audit-msg" style="color:var(--panel-muted)">' + agentAuditFallback + '</div></li>';
  } catch (error) {
    document.getElementById('summary').innerHTML = summaryCards({
      summary: { total: 0, mcpServices: 0, agentServices: 0, running: 0, runningMcp: 0, runningAgent: 0, degraded: 0, stopped: 0, local: 0, remote: 0 },
      systemServiceCount: 2
    });
    document.getElementById('rows').innerHTML = '<tr><td colspan="7" style="color:#a72525">UI render error: ' + String(error) + '</td></tr>';
    document.getElementById('agent-service-rows').innerHTML = '<tr><td colspan="7" style="color:#a72525">UI render error: ' + String(error) + '</td></tr>';
    document.getElementById('mcp-bootstrap-warning').innerHTML = '<div class="bootstrap-note warn"><strong>Client config status unavailable:</strong> UI render error.</div>';
    document.getElementById('bootstrap-config').innerHTML = '<div class="code" style="color:#a72525">UI render error</div>';
    document.getElementById('audit').innerHTML = '<li class="audit-item"><div class="audit-msg" style="color:#a72525">UI render error</div></li>';
    document.getElementById('agent-summary').innerHTML = agentSummaryCards({ totalRuns: 0, running: 0, waiting: 0, completed: 0, failed: 0, cancelled: 0 });
    document.getElementById('agent-audit').innerHTML = '<li class="audit-item"><div class="audit-msg" style="color:#a72525">UI render error</div></li>';
    document.getElementById('guide-overview-grid').innerHTML = '<div class="card"><div class="label">Capabilities</div><div class="value">0</div></div>';
    document.getElementById('guide-client-attachment').innerHTML = '<div class="code" style="color:#a72525">UI render error</div>';
    document.getElementById('guide-mcp-section').innerHTML = '<div class="code" style="color:#a72525">UI render error</div>';
    document.getElementById('guide-agent-section').innerHTML = '<div class="code" style="color:#a72525">UI render error</div>';
  }
}

const hitlDirectInputEl = document.getElementById('hitl-direct-input');
if (hitlDirectInputEl) {
  hitlDirectInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendHitlDirectInput();
    }
  });
}
const hitlBrokerInputEl = document.getElementById('hitl-broker-input');
if (hitlBrokerInputEl) {
  hitlBrokerInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendHitlBrokerAnswer();
    }
  });
}

setTab(activeTab);
setBootstrapCollapsed(bootstrapCollapsed);
refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
}
