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
      --panel: rgba(10, 16, 30, 0.78);
      --panel-2: rgba(11, 18, 34, 0.88);
      --line: rgba(159, 176, 199, 0.2);
      --text: #e8edf5;
      --muted: #9daec4;
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
    }

    .label {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.9px;
      font-size: 10px;
    }

    .value {
      margin-top: 6px;
      font-size: 24px;
      font-weight: 650;
      line-height: 1;
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
    }

    th {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.9px;
      font-size: 10px;
      font-weight: 600;
      background: rgba(15, 23, 42, 0.5);
    }

    tr:last-child td { border-bottom: none; }

    .id { color: var(--muted); font-size: 12px; margin-top: 4px; }

    .badge {
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 11px;
      font-weight: 700;
      display: inline-block;
      border: 1px solid transparent;
    }

    .run { background: rgba(22, 163, 74, 0.18); color: #7ff0ad; border-color: rgba(22, 163, 74, 0.35); }
    .stop { background: rgba(148, 163, 184, 0.12); color: #c4d1df; border-color: rgba(148, 163, 184, 0.28); }
    .crash { background: rgba(220, 38, 38, 0.16); color: #ffb5b5; border-color: rgba(220, 38, 38, 0.35); }

    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #c7e9ff;
      font-size: 12px;
    }

    .btn {
      border: 1px solid rgba(99, 102, 241, 0.32);
      color: #dfe8ff;
      background: linear-gradient(180deg, rgba(99,102,241,0.22), rgba(99,102,241,0.1));
      border-radius: 8px;
      padding: 6px 9px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      margin: 0 4px 4px 0;
      white-space: nowrap;
    }

    .btn.secondary {
      border-color: rgba(6, 182, 212, 0.3);
      background: linear-gradient(180deg, rgba(6,182,212,0.2), rgba(6,182,212,0.1));
    }

    .btn:hover { filter: brightness(1.1); }
    .btn.ghost {
      border-color: rgba(148, 163, 184, 0.35);
      background: rgba(10, 16, 30, 0.55);
      color: #cbd7e6;
    }
    .detail-row td {
      background: rgba(8, 14, 28, 0.72);
      border-top: none;
    }
    .detail-box {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .detail-title {
      color: var(--muted);
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

    .audit {
      max-height: 280px;
      overflow: auto;
    }

    .audit-title {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--muted);
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
      background: rgba(10, 16, 30, 0.72);
      font-size: 12px;
    }

    .audit-meta {
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 3px;
    }

    .audit-msg {
      color: var(--text);
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

    <div class="card audit">
      <h2 class="audit-title">Audit Timeline</h2>
      <ul id="audit" class="audit-list"></ul>
    </div>
  </div>
<script>
const expanded = {};
const detailCache = {};
let latestSystemTools = [];

async function call(path, method = 'GET') {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function badge(state) {
  const cls = state === 'RUNNING' ? 'run' : state === 'CRASHED' || state === 'QUARANTINED' ? 'crash' : 'stop';
  return '<span class="badge ' + cls + '">' + state + '</span>';
}

function summaryCards(data) {
  const s = data.summary;
  const systemCount = typeof data.systemToolCount === 'number' ? data.systemToolCount : 0;
  return [
    ['Services', s.total],
    ['System Tools', systemCount],
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

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderSystemDetails(systemTools) {
  const items = (systemTools || []).map((name) => '<li class="code">' + esc(name) + '</li>').join('');
  return '<div class="detail-box">' +
    '<h3 class="detail-title">System Tool Names</h3>' +
    (items ? '<ul class="detail-list">' + items + '</ul>' : '<div class="code">No system tools reported</div>') +
  '</div>';
}

function renderServiceDetails(serviceId, data) {
  if (!data) {
    return '<div class="detail-box"><div class="code">Loading details...</div></div>';
  }

  if (data.error) {
    return '<div class="detail-box"><div class="code" style="color:#ffb5b5">' + esc(data.error) + '</div></div>';
  }

  const tools = Array.isArray(data.tools) ? data.tools : [];
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const toolItems = tools.length > 0
    ? '<ul class="detail-list">' + tools.map((name) => '<li class="code">' + esc(name) + '</li>').join('') + '</ul>'
    : '<div class="code">No interface tools yet. Try Refresh Interface.</div>';
  const logItems = logs.length > 0
    ? '<ul class="detail-list">' + logs.map((line) => '<li class="code">' + esc(line) + '</li>').join('') + '</ul>'
    : '<div class="code">No recent logs.</div>';

  return '<div class="detail-box">' +
    '<h3 class="detail-title">Interface Tools</h3>' +
    toolItems +
    '<h3 class="detail-title">Recent Logs / Calls</h3>' +
    logItems +
  '</div>';
}

async function toggleDetails(key, kind, serviceId) {
  expanded[key] = !expanded[key];
  if (expanded[key] && kind === 'service' && !detailCache[key]) {
    try {
      const [iface, logs] = await Promise.all([
        call('/api/services/' + encodeURIComponent(serviceId) + '/interface'),
        call('/api/services/' + encodeURIComponent(serviceId) + '/logs?limit=15')
      ]);
      detailCache[key] = {
        tools: Array.isArray(iface.tools) ? iface.tools.map((t) => t && t.name ? t.name : '').filter(Boolean) : [],
        logs: Array.isArray(logs.lines) ? logs.lines : []
      };
    } catch (error) {
      detailCache[key] = {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  if (expanded[key] && kind === 'system') {
    detailCache[key] = { systemTools: latestSystemTools || [] };
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
      : { summary: { total: 0, running: 0, degraded: 0, stopped: 0, local: 0, remote: 0 }, services: [], systemTools: { items: [] } };
    const audit = auditResult.status === 'fulfilled'
      ? auditResult.value
      : { items: [] };
    const summarySafe = (data && data.summary) ? data.summary : { total: 0, running: 0, degraded: 0, stopped: 0, local: 0, remote: 0 };
    const services = Array.isArray(data && data.services) ? data.services : [];
    const systemTools = Array.isArray(data && data.systemTools && data.systemTools.items) ? data.systemTools.items : [];
    latestSystemTools = systemTools;
    document.getElementById('summary').innerHTML = summaryCards({
      summary: summarySafe,
      systemToolCount: systemTools.length
    });

    const systemRow = '<tr>' +
      '<td><strong>Runtime System</strong><div class="id code">system__runtime</div></td>' +
      '<td><span class="code">system</span></td>' +
      '<td><div class="code">built-in</div></td>' +
      '<td>' + badge('RUNNING') + '</td>' +
      '<td><span class="code">HEALTHY</span></td>' +
      '<td>' + systemTools.length + ' tools, 0 resources, 0 prompts</td>' +
      '<td>' +
        '<button class="btn ghost" onclick="toggleDetails(\'system__runtime\',\'system\',\'\')">Details</button>' +
      '</td>' +
    '</tr>';
    const systemDetailRow = expanded.system__runtime
      ? '<tr class="detail-row"><td colspan="7">' + renderSystemDetails(systemTools) + '</td></tr>'
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
      const key = 'svc__' + svc.serviceId;
      const detailRow = expanded[key]
        ? '<tr class="detail-row"><td colspan="7">' + renderServiceDetails(svc.serviceId, detailCache[key]) + '</td></tr>'
        : '';
      return '<tr>' +
        '<td><strong>' + (svc.displayName || svc.serviceId) + '</strong><div class="id code">' + svc.serviceId + '</div></td>' +
        '<td><span class="code">' + svc.originType + '</span></td>' +
        '<td><div class="code">' + restart + '</div>' + (remotePolicy ? '<div class="id code">' + remotePolicy + '</div>' : '') + '</td>' +
        '<td>' + badge(svc.lifecycle) + '</td>' +
        '<td><span class="code">' + svc.health + '</span></td>' +
        '<td>' + toolCount + ' tools, ' + resCount + ' resources, ' + promptCount + ' prompts</td>' +
        '<td>' +
          '<button class="btn ghost" onclick="toggleDetails(\'' + key + '\',\'service\',\'' + svc.serviceId + '\')">Details</button>' +
          '<button class="btn" data-service="' + svc.serviceId + '" data-op="start" onclick="action(this.dataset.service,this.dataset.op)">Start</button>' +
          '<button class="btn" data-service="' + svc.serviceId + '" data-op="stop" onclick="action(this.dataset.service,this.dataset.op)">Stop</button>' +
          '<button class="btn" data-service="' + svc.serviceId + '" data-op="restart" onclick="action(this.dataset.service,this.dataset.op)">Restart</button>' +
          '<button class="btn secondary" data-service="' + svc.serviceId + '" data-op="introspect" onclick="action(this.dataset.service,this.dataset.op)">Refresh Interface</button>' +
          (svc.lifecycle === 'QUARANTINED'
            ? '<button class="btn secondary" data-service="' + svc.serviceId + '" data-op="unquarantine" onclick="action(this.dataset.service,this.dataset.op)">Unquarantine</button>'
            : '') +
        '</td>' +
      '</tr>' + detailRow;
    }).join('');
    const rows = systemRow + systemDetailRow + serviceRows;
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="7" style="color:#9daec4">No services registered</td></tr>';

    const auditItems = Array.isArray(audit && audit.items) ? audit.items : [];
    const auditRows = auditItems.slice().reverse().map((evt) => {
      const sid = evt.serviceId ? ' [' + evt.serviceId + ']' : '';
      return '<li class="audit-item">' +
        '<div class="audit-meta">' + evt.at + ' · ' + evt.kind + sid + '</div>' +
        '<div class="audit-msg">' + evt.message + '</div>' +
      '</li>';
    }).join('');
    const auditFallback = statusResult.status === 'rejected'
      ? 'Status endpoint unavailable'
      : (auditResult.status === 'rejected' ? 'Audit endpoint unavailable' : 'No events yet');
    document.getElementById('audit').innerHTML = auditRows || '<li class="audit-item"><div class="audit-msg" style="color:#9daec4">' + auditFallback + '</div></li>';
  } catch (error) {
    document.getElementById('summary').innerHTML = summaryCards({
      summary: { total: 0, running: 0, degraded: 0, stopped: 0, local: 0, remote: 0 },
      systemToolCount: 0
    });
    document.getElementById('rows').innerHTML = '<tr><td colspan="7" style="color:#ffb5b5">UI render error: ' + String(error) + '</td></tr>';
    document.getElementById('audit').innerHTML = '<li class="audit-item"><div class="audit-msg" style="color:#ffb5b5">UI render error</div></li>';
  }
}

refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
}
