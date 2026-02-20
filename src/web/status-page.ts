export function renderStatusPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clarity Runtime Status</title>
  <style>
    :root {
      --bg-0: #0b1020;
      --bg-1: #121a34;
      --bg-2: #0e2b3c;
      --glass: rgba(11, 16, 32, 0.58);
      --glass-strong: rgba(11, 16, 32, 0.78);
      --text: #e7eef7;
      --muted: #9fb0c7;
      --line: rgba(159, 176, 199, 0.22);
      --violet: #6366f1;
      --purple: #8b5cf6;
      --cyan: #06b6d4;
      --ok: #4ade80;
      --warn: #facc15;
      --bad: #f87171;
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }

    body {
      margin: 0;
      color: var(--text);
      font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background:
        radial-gradient(circle at 88% -10%, rgba(99, 102, 241, 0.35), transparent 36%),
        radial-gradient(circle at 0% 100%, rgba(6, 182, 212, 0.25), transparent 38%),
        linear-gradient(135deg, var(--bg-0), var(--bg-1) 52%, var(--bg-2));
      padding: 24px;
    }

    .shell {
      max-width: 1220px;
      margin: 0 auto;
    }

    .hero {
      background: linear-gradient(145deg, rgba(99,102,241,0.2), rgba(6,182,212,0.16));
      border: 1px solid var(--line);
      border-radius: 18px;
      backdrop-filter: blur(7px);
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }

    .title-wrap { display: flex; align-items: center; gap: 12px; }

    .mark {
      width: 34px;
      height: 34px;
      transform: rotate(45deg);
      border-radius: 7px;
      background: linear-gradient(145deg, var(--violet), var(--cyan));
      box-shadow: 0 0 0 1px rgba(255,255,255,0.16) inset;
    }

    h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0.2px;
      background: linear-gradient(90deg, var(--violet), var(--purple), var(--cyan));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .sub { margin-top: 4px; color: var(--muted); font-size: 13px; }

    .pulse {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      background: var(--glass);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--muted);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--ok);
      box-shadow: 0 0 0 6px rgba(74, 222, 128, 0.17);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin: 16px 0 18px;
    }

    .card {
      background: var(--glass);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      backdrop-filter: blur(7px);
    }

    .k {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .v {
      font-size: 25px;
      font-weight: 700;
      margin-top: 6px;
      color: var(--text);
    }

    .table-wrap {
      overflow: auto;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: var(--glass-strong);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 960px;
    }

    th, td {
      text-align: left;
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }

    th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--muted);
      background: rgba(14, 43, 60, 0.35);
    }

    tr:last-child td { border-bottom: none; }

    .badge {
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 11px;
      font-weight: 700;
      display: inline-block;
      letter-spacing: 0.4px;
      border: 1px solid transparent;
    }

    .run { color: #082a17; background: var(--ok); }
    .stop { color: #c9d8e7; background: rgba(159,176,199,0.18); border-color: rgba(159,176,199,0.3); }
    .crash { color: #3c0000; background: var(--bad); }

    .btn {
      color: #f0f9ff;
      background: linear-gradient(135deg, var(--violet), var(--cyan));
      border: none;
      border-radius: 8px;
      padding: 6px 9px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      margin: 0 4px 4px 0;
      white-space: nowrap;
    }

    .btn:hover { filter: brightness(1.08); }

    .muted { color: var(--muted); }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #c6f2ff;
    }

    @media (max-width: 760px) {
      body { padding: 14px; }
      .hero { padding: 14px; }
      h1 { font-size: 20px; }
      .v { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="hero">
      <div>
        <div class="title-wrap">
          <span class="mark" aria-hidden="true"></span>
          <h1>Clarity Gateway Control Plane</h1>
        </div>
        <div class="sub">Single runtime managing local and remote MCP services</div>
      </div>
      <div class="pulse"><span class="dot"></span> live status</div>
    </header>

    <div class="grid" id="summary"></div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Origin</th>
            <th>State</th>
            <th>Health</th>
            <th>Interface</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>
<script>
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
  return [
    ['Total', s.total],
    ['Running', s.running],
    ['Degraded', s.degraded],
    ['Stopped', s.stopped],
    ['Local', s.local],
    ['Remote', s.remote]
  ].map(([k, v]) => '<div class="card"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>').join('');
}

async function action(id, op) {
  await call('/api/services/' + encodeURIComponent(id) + '/' + op, 'POST');
  await refresh();
}

async function refresh() {
  const data = await call('/api/status');
  document.getElementById('summary').innerHTML = summaryCards(data);
  const rows = data.services.map((svc) => {
    const toolCount = svc.interface?.tools ?? 0;
    const resCount = svc.interface?.resources ?? 0;
    const promptCount = svc.interface?.prompts ?? 0;
    return '<tr>' +
      '<td><strong>' + (svc.displayName || svc.serviceId) + '</strong><br><span class="muted"><code>' + svc.serviceId + '</code></span></td>' +
      '<td><code>' + svc.originType + '</code></td>' +
      '<td>' + badge(svc.lifecycle) + '</td>' +
      '<td><code>' + svc.health + '</code></td>' +
      '<td>' + toolCount + ' tools, ' + resCount + ' resources, ' + promptCount + ' prompts</td>' +
      '<td>' +
        '<button class="btn" onclick="action(\'' + svc.serviceId + '\',\'start\')">Start</button>' +
        '<button class="btn" onclick="action(\'' + svc.serviceId + '\',\'stop\')">Stop</button>' +
        '<button class="btn" onclick="action(\'' + svc.serviceId + '\',\'restart\')">Restart</button>' +
        '<button class="btn" onclick="action(\'' + svc.serviceId + '\',\'introspect\')">Refresh Interface</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  document.getElementById('rows').innerHTML = rows || '<tr><td colspan="6" class="muted">No services registered</td></tr>';
}

refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
}
