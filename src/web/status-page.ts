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
    .trigger-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .run-summary {
      display: grid;
      gap: 4px;
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

    @media (max-width: 760px) {
      body { padding: 14px; }
      .title { font-size: 20px; }
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

    <div id="agents-panel" style="display:none">
      <div class="grid" id="agent-summary"></div>
      <div class="trigger-filters" id="agent-trigger-filters">
        <button class="btn ghost" data-trigger-filter="all" onclick="setAgentTriggerFilter(this.dataset.triggerFilter)">All Triggers</button>
        <button class="btn ghost" data-trigger-filter="timer" onclick="setAgentTriggerFilter(this.dataset.triggerFilter)">Timer</button>
        <button class="btn ghost" data-trigger-filter="event" onclick="setAgentTriggerFilter(this.dataset.triggerFilter)">Event</button>
        <button class="btn ghost" data-trigger-filter="call" onclick="setAgentTriggerFilter(this.dataset.triggerFilter)">Call</button>
        <button class="btn ghost" data-trigger-filter="api" onclick="setAgentTriggerFilter(this.dataset.triggerFilter)">API</button>
        <button class="btn ghost" data-trigger-filter="a2a" onclick="setAgentTriggerFilter(this.dataset.triggerFilter)">A2A</button>
        <button class="btn ghost" data-trigger-filter="unknown" onclick="setAgentTriggerFilter(this.dataset.triggerFilter)">Unknown</button>
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
let activeAgentTriggerFilter = 'all';
let bootstrapFormDirty = false;
let bootstrapFormInitialized = false;
let bootstrapActionMessage = '';
let bootstrapCollapsed = false;
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
  if (trigger === 'timer' || trigger === 'event' || trigger === 'call' || trigger === 'api' || trigger === 'a2a') {
    return trigger;
  }
  return 'unknown';
}

function triggerBadge(value) {
  const trigger = normalizeTrigger(value);
  return '<span class="trigger">' + esc(trigger) + '</span>';
}

function setAgentTriggerFilter(value) {
  const next = String(value || 'all').toLowerCase();
  if (next === 'all' || next === 'timer' || next === 'event' || next === 'call' || next === 'api' || next === 'a2a' || next === 'unknown') {
    activeAgentTriggerFilter = next;
  } else {
    activeAgentTriggerFilter = 'all';
  }
  refresh();
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
  activeTab = tab === 'agents' || tab === 'client-config' ? tab : 'mcp';
  const mcpPanel = document.getElementById('mcp-panel');
  const agentsPanel = document.getElementById('agents-panel');
  const clientConfigPanel = document.getElementById('client-config-panel');
  const mcpTab = document.getElementById('tab-mcp');
  const agentsTab = document.getElementById('tab-agents');
  const clientConfigTab = document.getElementById('tab-client-config');
  if (!mcpPanel || !agentsPanel || !clientConfigPanel || !mcpTab || !agentsTab || !clientConfigTab) return;
  mcpPanel.style.display = activeTab === 'mcp' ? '' : 'none';
  agentsPanel.style.display = activeTab === 'agents' ? '' : 'none';
  clientConfigPanel.style.display = activeTab === 'client-config' ? '' : 'none';
  mcpTab.classList.toggle('active', activeTab === 'mcp');
  agentsTab.classList.toggle('active', activeTab === 'agents');
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

function renderTriggerInterfaces(runs) {
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
  if (latestByTrigger.call) {
    const run = latestByTrigger.call;
    blocks.push('<div class="detail-box"><h3 class="detail-title">Call Interface</h3>' +
      '<div class="code">callerType: ' + esc(readTriggerContext(run, 'callerType') || 'n/a') + '</div>' +
      '<div class="code">callerId: ' + esc(readTriggerContext(run, 'callerId') || 'n/a') + '</div></div>');
  }
  if (latestByTrigger.a2a) {
    const run = latestByTrigger.a2a;
    blocks.push('<div class="detail-box"><h3 class="detail-title">A2A Interface</h3>' +
      '<div class="code">fromAgentId: ' + esc(readTriggerContext(run, 'fromAgentId') || 'n/a') + '</div>' +
      '<div class="code">parentRunId: ' + esc(readTriggerContext(run, 'parentRunId') || 'n/a') + ', reason: ' + esc(readTriggerContext(run, 'handoffReason') || 'n/a') + '</div></div>');
  }
  if (blocks.length === 0) {
    return '<div class="code">No observed trigger interface data yet. Run the agent via timer/event/call/api/a2a to populate this section.</div>';
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
    : ['timer', 'event', 'call', 'api', 'a2a'];

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
  const defaultTriggerFlow = '<div class="detail-box">' +
    '<h3 class="detail-title">How This Agent Can Be Triggered</h3>' +
    '<div>' +
      '<span class="trigger">timer</span>' +
      '<span class="trigger">event</span>' +
      '<span class="trigger">call</span>' +
      '<span class="trigger">api</span>' +
      '<span class="trigger">a2a</span>' +
    '</div>' +
    '<h3 class="detail-title">Standard Flow</h3>' +
    renderAgentStandardFlow(agent, agentRunsForService) +
  '</div>';
  const agentMeta = agent
    ? defaultTriggerFlow +
      '<h3 class="detail-title">Trigger Interfaces (Observed)</h3>' +
      renderTriggerInterfaces(agentRunsForService) +
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
    const filteredAgentRuns = filterRunsByTrigger(agentRuns, activeAgentTriggerFilter);
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
    const triggerFilterRoot = document.getElementById('agent-trigger-filters');
    if (triggerFilterRoot) {
      const buttons = triggerFilterRoot.querySelectorAll('[data-trigger-filter]');
      buttons.forEach((btn) => {
        const selected = btn && btn.dataset ? btn.dataset.triggerFilter : '';
        btn.classList.toggle('secondary', selected === activeAgentTriggerFilter || (activeAgentTriggerFilter === 'all' && selected === 'all'));
      });
    }

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
          '<button class="btn" data-service="' + serviceId + '" data-op="restart" onclick="action(this.dataset.service,this.dataset.op)">Restart</button>' +
          (svc.lifecycle === 'QUARANTINED'
            ? '<button class="btn secondary" data-service="' + serviceId + '" data-op="unquarantine" onclick="action(this.dataset.service,this.dataset.op)">Unquarantine</button>'
            : '') +
        '</td>' +
      '</tr>' + detailRow;
    }).join('');
    const rows = runtimeSystemRow + runtimeSystemDetailRow + claritySystemRow + claritySystemDetailRow + serviceRows;
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="7" style="color:var(--panel-muted)">No MCP services registered</td></tr>';

    const agentServiceRows = agentServices.map((svc) => {
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
      const matchedRuns = filteredAgentRuns.filter((run) => runBelongsToService(run, svc));
      const latestRun = matchedRuns.length > 0 ? matchedRuns[0] : null;
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
          '<button class="btn" data-service="' + serviceId + '" data-op="restart" onclick="action(this.dataset.service,this.dataset.op)">Restart</button>' +
          (svc.lifecycle === 'QUARANTINED'
            ? '<button class="btn secondary" data-service="' + serviceId + '" data-op="unquarantine" onclick="action(this.dataset.service,this.dataset.op)">Unquarantine</button>'
            : '') +
        '</td>' +
      '</tr>' + detailRow;
    }).join('');
    document.getElementById('agent-service-rows').innerHTML = agentServiceRows || '<tr><td colspan="7" style="color:var(--panel-muted)">No agent services registered</td></tr>';

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
  }
}

setTab(activeTab);
setBootstrapCollapsed(bootstrapCollapsed);
refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
}
