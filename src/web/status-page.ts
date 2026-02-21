export function renderStatusPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
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
    .stop { background: rgba(71, 85, 105, 0.12); color: #465b77; border-color: rgba(71, 85, 105, 0.28); }
    .crash { background: rgba(220, 38, 38, 0.12); color: #a72525; border-color: rgba(220, 38, 38, 0.35); }

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
    .inspector {
      margin-top: 14px;
      margin-bottom: 14px;
    }
    .bootstrap {
      margin-top: 14px;
      margin-bottom: 14px;
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

    <div class="grid" id="summary"></div>

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

    <div class="card inspector">
      <h2 class="audit-title">Service Inspector</h2>
      <div id="inspector" class="code" style="display:grid; gap:8px; color:var(--panel-muted)">Select a service row and click Open.</div>
    </div>

    <div class="card bootstrap">
      <h2 class="audit-title">Client Bootstrap Config</h2>
      <div id="bootstrap-config" class="code" style="display:grid; gap:8px; color:var(--panel-muted)">Loading bootstrap config...</div>
      <div style="margin-top:8px;">
        <button class="btn secondary" onclick="bootstrapClients()">Configure Codex + Claude</button>
      </div>
    </div>

    <div class="card audit">
      <h2 class="audit-title">Audit Timeline</h2>
      <ul id="audit" class="audit-list"></ul>
    </div>
  </div>
<script>
const expanded = {};
const detailCache = {};
let latestRuntimeTools = [];
let latestClarityTools = [];
let selectedServiceId = null;
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

function badge(state) {
  const cls = state === 'RUNNING' ? 'run' : state === 'CRASHED' || state === 'QUARANTINED' ? 'crash' : 'stop';
  return '<span class="badge ' + cls + '">' + esc(state) + '</span>';
}

function summaryCards(data) {
  const s = data.summary;
  const runtimeCount = typeof data.runtimeToolCount === 'number' ? data.runtimeToolCount : 0;
  const clarityCount = typeof data.clarityToolCount === 'number' ? data.clarityToolCount : 0;
  return [
    ['Services', s.total],
    ['Runtime Tools', runtimeCount],
    ['Clarity Tools', clarityCount],
    ['Running', s.running],
    ['Degraded', s.degraded],
    ['Stopped', s.stopped],
    ['Local', s.local],
    ['Remote', s.remote]
  ].map(([k, v]) => '<div class="card"><div class="label">' + k + '</div><div class="value">' + v + '</div></div>').join('');
}

async function action(id, op) {
  await call('/api/services/' + encodeURIComponent(id) + '/' + op, 'POST');
  await refresh();
}

async function bootstrapClients() {
  await call('/api/bootstrap', 'POST', JSON.stringify({ clients: ['codex', 'claude'] }));
  await refresh();
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderSystemDetails(runtimeTools, clarityTools) {
  const runtimeItems = (runtimeTools || []).map((name) => '<li class="code">' + esc(name) + '</li>').join('');
  const clarityItems = (clarityTools || []).map((name) => '<li class="code">' + esc(name) + '</li>').join('');
  return '<div class="detail-box">' +
    '<h3 class="detail-title">Runtime Tool Names</h3>' +
    (runtimeItems ? '<ul class="detail-list">' + runtimeItems + '</ul>' : '<div class="code">No runtime tools reported</div>') +
    '<h3 class="detail-title">Clarity Tool Names</h3>' +
    (clarityItems ? '<ul class="detail-list">' + clarityItems + '</ul>' : '<div class="code">No clarity tools reported</div>') +
  '</div>';
}

function renderServiceDetails(serviceId, data) {
  if (!data) {
    return '<div class="detail-box"><div class="code">Loading details...</div></div>';
  }

  if (data.error) {
    return '<div class="detail-box"><div class="code" style="color:#a72525">' + esc(data.error) + '</div></div>';
  }

  const iface = data.interface || {};
  const tools = Array.isArray(iface.tools) ? iface.tools.map((t) => t && t.name ? t.name : '').filter(Boolean) : [];
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const calls = Array.isArray(data.recentCalls) ? data.recentCalls : [];
  const toolItems = tools.length > 0
    ? '<ul class="detail-list">' + tools.map((name) => '<li class="code">' + esc(name) + '</li>').join('') + '</ul>'
    : '<div class="code">No interface tools yet. Try Refresh Interface.</div>';
  const logItems = logs.length > 0
    ? '<ul class="detail-list">' + logs.map((line) => '<li class="code">' + esc(line) + '</li>').join('') + '</ul>'
    : '<div class="code">No recent logs.</div>';
  const callItems = calls.length > 0
    ? '<ul class="detail-list">' + calls.map((row) => '<li class="code">' + esc(row.at + ' ' + row.message) + '</li>').join('') + '</ul>'
    : '<div class="code">No recent tool calls.</div>';

  return '<div class="detail-box">' +
    '<h3 class="detail-title">Interface Tools</h3>' +
    toolItems +
    '<h3 class="detail-title">Recent Tool Calls</h3>' +
    callItems +
    '<h3 class="detail-title">Recent Logs / Calls</h3>' +
    logItems +
  '</div>';
}

function getSelectedFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('service');
}

function setSelectedInQuery(serviceId) {
  const params = new URLSearchParams(window.location.search);
  if (serviceId) {
    params.set('service', serviceId);
  } else {
    params.delete('service');
  }
  const next = window.location.pathname + '?' + params.toString();
  window.history.replaceState({}, '', next);
}

async function openService(serviceId) {
  selectedServiceId = serviceId;
  setSelectedInQuery(serviceId);
  await refresh();
}

async function toggleDetails(key, kind, serviceId) {
  expanded[key] = !expanded[key];
  if (expanded[key] && kind === 'service' && !detailCache[key]) {
    try {
      detailCache[key] = await call('/api/services/' + encodeURIComponent(serviceId) + '/details?log_limit=20&event_limit=60&call_limit=20');
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

async function refresh() {
  try {
    const [statusResult, auditResult] = await Promise.allSettled([
      call('/api/status'),
      call('/api/audit?limit=25')
    ]);
    const data = statusResult.status === 'fulfilled'
      ? statusResult.value
      : {
        summary: { total: 0, running: 0, degraded: 0, stopped: 0, local: 0, remote: 0 },
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
    const summarySafe = (data && data.summary) ? data.summary : { total: 0, running: 0, degraded: 0, stopped: 0, local: 0, remote: 0 };
    const services = Array.isArray(data && data.services) ? data.services : [];
    const runtimeTools = Array.isArray(data && data.systemTools && data.systemTools.runtime && data.systemTools.runtime.items)
      ? data.systemTools.runtime.items
      : [];
    const clarityTools = Array.isArray(data && data.systemTools && data.systemTools.clarity && data.systemTools.clarity.items)
      ? data.systemTools.clarity.items
      : [];
    let bootstrap = { clients: [] };
    try {
      bootstrap = await call('/api/bootstrap/status');
    } catch {
      bootstrap = { clients: [] };
    }
    latestRuntimeTools = runtimeTools;
    latestClarityTools = clarityTools;
    if (selectedServiceId === null) {
      selectedServiceId = getSelectedFromQuery();
    }
    document.getElementById('summary').innerHTML = summaryCards({
      summary: summarySafe,
      runtimeToolCount: runtimeTools.length,
      clarityToolCount: clarityTools.length
    });

    const systemRow = '<tr>' +
      '<td><strong>Runtime System</strong><div class="id code">system__runtime</div></td>' +
      '<td><span class="code">system</span></td>' +
      '<td><div class="code">built-in</div></td>' +
      '<td>' + badge('RUNNING') + '</td>' +
      '<td><span class="code">HEALTHY</span></td>' +
      '<td>' + runtimeTools.length + ' runtime tools, ' + clarityTools.length + ' clarity tools</td>' +
      '<td>' +
        '<button class="btn ghost" data-key="system__runtime" data-kind="system" data-service="" onclick="toggleDetails(this.dataset.key,this.dataset.kind,this.dataset.service)">Details</button>' +
        '<button class="btn ghost" data-service="system__runtime" onclick="openService(this.dataset.service)">Open</button>' +
      '</td>' +
    '</tr>';
    const systemDetailRow = expanded.system__runtime
      ? '<tr class="detail-row"><td colspan="7">' + renderSystemDetails(runtimeTools, clarityTools) + '</td></tr>'
      : '';

    const serviceRows = services.map((svc) => {
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
        ? '<tr class="detail-row"><td colspan="7">' + renderServiceDetails(svc.serviceId, detailCache[key]) + '</td></tr>'
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
          '<button class="btn ghost" data-service="' + serviceId + '" onclick="openService(this.dataset.service)">Open</button>' +
          '<button class="btn" data-service="' + serviceId + '" data-op="start" onclick="action(this.dataset.service,this.dataset.op)">Start</button>' +
          '<button class="btn" data-service="' + serviceId + '" data-op="stop" onclick="action(this.dataset.service,this.dataset.op)">Stop</button>' +
          '<button class="btn" data-service="' + serviceId + '" data-op="restart" onclick="action(this.dataset.service,this.dataset.op)">Restart</button>' +
          '<button class="btn secondary" data-service="' + serviceId + '" data-op="introspect" onclick="action(this.dataset.service,this.dataset.op)">Refresh Interface</button>' +
          (svc.lifecycle === 'QUARANTINED'
            ? '<button class="btn secondary" data-service="' + serviceId + '" data-op="unquarantine" onclick="action(this.dataset.service,this.dataset.op)">Unquarantine</button>'
            : '') +
        '</td>' +
      '</tr>' + detailRow;
    }).join('');
    const rows = systemRow + systemDetailRow + serviceRows;
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="7" style="color:var(--panel-muted)">No services registered</td></tr>';

    if (!selectedServiceId) {
      document.getElementById('inspector').innerHTML = 'Select a service row and click Open.';
    } else if (selectedServiceId === 'system__runtime') {
      document.getElementById('inspector').innerHTML =
        '<div class="detail-box">' +
          '<h3 class="detail-title">Runtime System</h3>' +
          '<div class="code">Built-in runtime + clarity MCP tools.</div>' +
          '<h3 class="detail-title">Runtime Tool Names</h3>' +
          '<ul class="detail-list">' + runtimeTools.map((name) => '<li class="code">' + esc(name) + '</li>').join('') + '</ul>' +
          '<h3 class="detail-title">Clarity Tool Names</h3>' +
          '<ul class="detail-list">' + clarityTools.map((name) => '<li class="code">' + esc(name) + '</li>').join('') + '</ul>' +
        '</div>';
    } else {
      try {
        const inspectorData = await call('/api/services/' + encodeURIComponent(selectedServiceId) + '/details?log_limit=60&event_limit=120&call_limit=30');
        detailCache['svc__' + selectedServiceId] = inspectorData;
        document.getElementById('inspector').innerHTML =
          '<div class="detail-box">' +
            '<h3 class="detail-title">Service</h3>' +
            '<div class="code">' + esc((inspectorData.summary && inspectorData.summary.displayName) || selectedServiceId) + '</div>' +
            '<div class="id code">' + esc(selectedServiceId) + '</div>' +
          '</div>' +
          renderServiceDetails(selectedServiceId, inspectorData);
      } catch (error) {
        document.getElementById('inspector').innerHTML =
          '<div class="detail-box"><div class="code" style="color:#a72525">' + esc(error instanceof Error ? error.message : String(error)) + '</div></div>';
      }
    }

    const bootstrapClients = Array.isArray(bootstrap && bootstrap.clients) ? bootstrap.clients : [];
    const bootstrapRows = bootstrapClients.map((row) => {
      const configured = row && row.configured ? 'configured' : 'missing';
      const cmd = row && row.command ? row.command : 'n/a';
      const args = row && Array.isArray(row.args) && row.args.length > 0 ? row.args.join(' ') : '';
      return '<div class="detail-box">' +
        '<div><strong>' + esc(row.client || 'unknown') + '</strong> <span class="id code">(' + configured + ')</span></div>' +
        '<div class="code">' + esc(row.path || '') + '</div>' +
        '<div class="code">command: ' + esc(cmd + (args ? ' ' + args : '')) + '</div>' +
      '</div>';
    }).join('');
    document.getElementById('bootstrap-config').innerHTML = bootstrapRows || '<div class="code">Bootstrap status unavailable.</div>';

    const auditItems = Array.isArray(audit && audit.items) ? audit.items : [];
    const auditRows = auditItems.slice().reverse().map((evt) => {
      const sid = evt.serviceId ? ' [' + esc(evt.serviceId) + ']' : '';
      return '<li class="audit-item">' +
        '<div class="audit-meta">' + esc(evt.at) + ' · ' + esc(evt.kind) + sid + '</div>' +
        '<div class="audit-msg">' + esc(evt.message) + '</div>' +
      '</li>';
    }).join('');
    const auditFallback = statusResult.status === 'rejected'
      ? 'Status endpoint unavailable'
      : (auditResult.status === 'rejected' ? 'Audit endpoint unavailable' : 'No events yet');
    document.getElementById('audit').innerHTML = auditRows || '<li class="audit-item"><div class="audit-msg" style="color:var(--panel-muted)">' + auditFallback + '</div></li>';
  } catch (error) {
    document.getElementById('summary').innerHTML = summaryCards({
      summary: { total: 0, running: 0, degraded: 0, stopped: 0, local: 0, remote: 0 },
      runtimeToolCount: 0,
      clarityToolCount: 0
    });
    document.getElementById('rows').innerHTML = '<tr><td colspan="7" style="color:#a72525">UI render error: ' + String(error) + '</td></tr>';
    document.getElementById('inspector').innerHTML = '<div class="code" style="color:#a72525">UI render error</div>';
    document.getElementById('bootstrap-config').innerHTML = '<div class="code" style="color:#a72525">UI render error</div>';
    document.getElementById('audit').innerHTML = '<li class="audit-item"><div class="audit-msg" style="color:#a72525">UI render error</div></li>';
  }
}

refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
}
