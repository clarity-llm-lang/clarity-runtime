export function renderStatusPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clarity Runtime Status</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #ffffff;
      --text: #1f2933;
      --muted: #52606d;
      --ok: #137333;
      --warn: #9a6700;
      --bad: #b42318;
      --accent: #0057b8;
      --border: #d9e2ec;
    }
    body { margin: 0; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; color: var(--text); background: radial-gradient(circle at top right, #dde7ff 0%, var(--bg) 42%); }
    header { padding: 24px 28px 8px; }
    h1 { margin: 0; font-size: 24px; }
    .sub { color: var(--muted); margin-top: 6px; }
    .wrap { padding: 0 24px 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(170px,1fr)); gap: 12px; margin: 16px 0 22px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
    .k { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .v { font-size: 24px; font-weight: 700; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; color: var(--muted); }
    tr:last-child td { border-bottom: none; }
    .badge { border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 600; display: inline-block; }
    .run { color: var(--ok); background: #e9f7ef; }
    .stop { color: var(--muted); background: #eef2f6; }
    .crash { color: var(--bad); background: #fdecec; }
    .btn { color: #fff; background: var(--accent); border: none; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
    .muted { color: var(--muted); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Clarity Gateway Control Plane</h1>
    <div class="sub">Single runtime managing local and remote MCP services</div>
  </header>
  <div class="wrap">
    <div class="grid" id="summary"></div>
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
        '<button class="btn" onclick="action(\'' + svc.serviceId + '\',\'start\')">Start</button> ' +
        '<button class="btn" onclick="action(\'' + svc.serviceId + '\',\'stop\')">Stop</button> ' +
        '<button class="btn" onclick="action(\'' + svc.serviceId + '\',\'restart\')">Restart</button> ' +
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
