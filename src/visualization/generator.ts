/**
 * PMM Visualization — HTML Dashboard Generator
 * =============================================
 * Builds self-contained HTML dashboards with:
 * - Terminal shell dark aesthetic (merged from superpowers design system)
 * - Chart.js v4 CDN for Gantt, line, bar charts
 * - Pure CSS for kanban boards, health gauges, portfolio tree, timeline
 * - SSE EventSource integration for live mode
 * - Zero external dependencies, zero build step, zero npm install
 */
import type { ProjectDashboardData, PortfolioDashboardData, ProjectSummary } from "./data";

// ── Color Tokens (terminal shell dark aesthetic) ──
export const COLORS = {
  bg: "#0a0a0f",
  surface: "#13132b",
  surfaceAlt: "#1a1a35",
  border: "#1e1e2e",
  text: "#e2e8f0",
  textDim: "#6b7280",
  accent: "#a78bfa",
  accentDim: "#7c5cfc",
  healthy: "#34d399",
  attention: "#fbbf24",
  blocked: "#f87171",
  stale: "#6b7280",
  purple: "#a78bfa",
  blue: "#60a5fa",
  cyan: "#22d3ee",
  pink: "#f472b6",
  orange: "#fb923c",
};

/** Health color lookup */
export function healthColor(health: string): string {
  const map: Record<string, string> = {
    healthy: COLORS.healthy,
    attention: COLORS.attention,
    blocked: COLORS.blocked,
    stale: COLORS.stale,
    critical: COLORS.blocked,
  };
  return map[health] || COLORS.stale;
}

/** Priority badge colors */
function priorityColor(p: string): string {
  const map: Record<string, string> = {
    critical: COLORS.blocked,
    high: COLORS.attention,
    medium: COLORS.blue,
    low: COLORS.textDim,
  };
  return map[p] || COLORS.textDim;
}

/** Phase icon */
function phaseIcon(phase: string): string {
  const map: Record<string, string> = {
    discover: "🔍",
    define: "📋",
    design: "🎨",
    build: "🛠",
    ship: "🚀",
    maintain: "🔧",
  };
  return map[phase] || "○";
}

// ── CSS Template ──

const SHARED_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: ${COLORS.bg};
  color: ${COLORS.text};
  font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  padding: 24px;
  -webkit-font-smoothing: antialiased;
}
h1 { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 4px; }
h2 { font-size: 15px; font-weight: 600; color: ${COLORS.accent}; margin: 20px 0 12px; }
h3 { font-size: 13px; font-weight: 600; color: ${COLORS.text}; margin: 14px 0 8px; }
.header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.header-info { color: ${COLORS.textDim}; font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; margin-bottom: 14px; }
.card {
  background: ${COLORS.surface};
  border: 1px solid ${COLORS.border};
  border-radius: 8px;
  padding: 16px;
  position: relative;
}
.card-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.textDim}; margin-bottom: 10px; }
.row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
.label { color: ${COLORS.textDim}; font-size: 12px; }
.value { font-size: 12px; font-weight: 600; }
.badge {
  display: inline-block; padding: 1px 8px; border-radius: 3px;
  font-size: 10px; font-weight: 600; text-transform: uppercase;
}
.reset-btn {
  background: ${COLORS.surfaceAlt}; color: ${COLORS.text}; border: 1px solid ${COLORS.border};
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 12px;
}
.reset-btn:hover { background: ${COLORS.border}; }

/* ── Health Gauge ── */
.gauge-ring {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  position: relative; flex-shrink: 0;
}
.gauge-ring svg { transform: rotate(-90deg); }
.gauge-ring .score {
  position: absolute; font-size: 18px; font-weight: 700;
}

/* ── Gantt Row ── */
.gantt-timeline { margin-top: 8px; }
.gantt-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.gantt-label { width: 140px; font-size: 11px; color: ${COLORS.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gantt-track { flex: 1; height: 20px; background: ${COLORS.border}; border-radius: 3px; position: relative; overflow: hidden; }
.gantt-bar { height: 100%; border-radius: 3px; position: absolute; left: 0; top: 0; }
.gantt-pct { font-size: 10px; color: ${COLORS.textDim}; width: 40px; text-align: right; }
.gantt-now { position: absolute; top: 0; bottom: 0; width: 2px; background: ${COLORS.attention}; opacity: 0.7; }

/* ── Kanban ── */
.kanban { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 8px; }
.kanban-col { background: ${COLORS.surface}; border: 1px solid ${COLORS.border}; border-radius: 6px; padding: 10px; }
.kanban-col h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.textDim}; margin-bottom: 8px; }
.kanban-card {
  background: ${COLORS.surfaceAlt}; border: 1px solid ${COLORS.border}; border-radius: 4px;
  padding: 8px 10px; margin: 6px 0; font-size: 11px;
}

/* ── Timeline ── */
.timeline { position: relative; padding-left: 24px; }
.timeline::before {
  content: ''; position: absolute; left: 7px; top: 4px; bottom: 4px;
  width: 2px; background: ${COLORS.border};
}
.timeline-item { position: relative; margin: 12px 0; padding-left: 12px; }
.timeline-dot {
  position: absolute; left: -21px; top: 4px; width: 10px; height: 10px;
  border-radius: 50%; border: 2px solid;
}
.timeline-dot.done { background: ${COLORS.healthy}; border-color: ${COLORS.healthy}; }
.timeline-dot.in-progress { background: ${COLORS.accent}; border-color: ${COLORS.accent}; }
.timeline-dot.pending { background: ${COLORS.bg}; border-color: ${COLORS.textDim}; }
.timeline-dot.blocked { background: ${COLORS.blocked}; border-color: ${COLORS.blocked}; }

/* ── Portfolio Tree ── */
.tree { list-style: none; padding-left: 0; }
.tree li { position: relative; padding: 3px 0 3px 24px; }
.tree .node-toggle { cursor: pointer; user-select: none; font-size: 10px; color: ${COLORS.textDim}; margin-right: 4px; }
.tree .node-name { color: ${COLORS.text}; font-size: 12px; }
.tree .node-meta { color: ${COLORS.textDim}; font-size: 10px; margin-left: 6px; }
.tree ul { padding-left: 20px; }
.tree .health-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }

/* ── Live Feed ── */
.feed-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid ${COLORS.border}; font-size: 11px; }
.feed-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.feed-status.running { background: ${COLORS.accent}; animation: pulse 1.5s infinite; }
.feed-status.completed { background: ${COLORS.healthy}; }
.feed-status.failed { background: ${COLORS.blocked}; }
.feed-status.dispatched { background: ${COLORS.blue}; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* ── Burndown ── */
.chart-container { width: 100%; max-height: 300px; position: relative; }

/* ── Tabs ── */
.tabs { display: flex; gap: 4px; margin-bottom: 16px; }
.tab {
  padding: 6px 14px; border-radius: 4px; cursor: pointer; font-family: inherit;
  font-size: 12px; background: transparent; color: ${COLORS.textDim}; border: 1px solid transparent;
}
.tab:hover { color: ${COLORS.text}; border-color: ${COLORS.border}; }
.tab.active { background: ${COLORS.surfaceAlt}; color: ${COLORS.accent}; border-color: ${COLORS.accent}; }
.tab-content { display: none; }
.tab-content.active { display: block; }

/* ── Empty / Meta ── */
.empty { color: ${COLORS.textDim}; font-style: italic; font-size: 12px; padding: 20px 0; text-align: center; }
.meta-bar {
  background: ${COLORS.surface}; border: 1px solid ${COLORS.border}; border-radius: 6px;
  padding: 8px 14px; font-size: 11px; color: ${COLORS.textDim};
  display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 16px;
}
`;

// ── Chart JS embed (common script block) ──

const CHART_JS_CDN = `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>`;

function tabScript(ids: string[]): string {
  return `
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
    t.classList.add('active');
    const content = document.getElementById(t.dataset.tab);
    if (content) content.classList.add('active');
    if (t.dataset.tab === 'gantt-chart' && window.ganttChart) setTimeout(() => window.ganttChart.resize(), 50);
  }));
  `;
}

// ══════════════════════════════════════════════════════════════
// SINGLE-PROJECT DASHBOARD
// ══════════════════════════════════════════════════════════════

export function generateProjectDashboard(data: ProjectDashboardData, filterType?: string): string {
  const { project, milestones, features, tasks, roadblocks, workers, sessions } = data;
  const p = project;

  const hc = healthColor(p.health);

  // ── Health gauge ring SVG ──
  const healthScore = p.health === "healthy" ? 85 : p.health === "attention" ? 60 : p.health === "blocked" ? 30 : 15;
  const circumference = 2 * Math.PI * 26;
  const offset = circumference - (healthScore / 100) * circumference;

  const gaugeSvg = `
  <div class="gauge-ring" style="border: 2px solid ${COLORS.border};">
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="26" fill="none" stroke="${COLORS.border}" stroke-width="4"/>
      <circle cx="32" cy="32" r="26" fill="none" stroke="${hc}" stroke-width="4"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
    </svg>
    <span class="score" style="color: ${hc};">${healthScore}</span>
  </div>`;

  // ── Stats row ──
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const totalTasks = tasks.length;
  const activeRoadblocks = roadblocks.filter((r) => !r.resolution).length;

  // ── Header ──
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(p.name)} — PMM Dashboard</title>
${CHART_JS_CDN}
<style>${SHARED_CSS}</style>
</head>
<body>

<div class="header">
  ${gaugeSvg}
  <div>
    <h1>${escHtml(p.name)}</h1>
    <div class="header-info">
      ${phaseIcon(p.phase)} ${p.phase} · <span style="color:${priorityColor(p.priority)}">${p.priority}</span>
      · ${p.status}
      ${p.last_active_days !== null ? ` · last session ${p.last_active_days}d ago` : ""}
    </div>
  </div>
</div>

<div class="meta-bar">
  <span>📊 ${totalTasks} tasks (${doneTasks} done)</span>
  <span>🏁 ${milestones.length} milestones</span>
  <span>📌 ${features.length} features</span>
  <span>⚠ ${activeRoadblocks} roadblocks</span>
  <span>🔄 ${workers.length} workers</span>
  <span>📋 ${sessions.length} sessions</span>
</div>`;

  // ── Tabs ──
  const tabIds: string[] = [];
  if (milestones.length) tabIds.push("gantt");
  if (features.length) tabIds.push("kanban");
  tabIds.push("health");
  if (tasks.length) tabIds.push("timeline");
  if (workers.length) tabIds.push("feed");

  if (tabIds.length > 1) {
    html += `<div class="tabs">`;
    for (const id of tabIds) {
      const labels: Record<string, string> = {
        gantt: "📊 Timeline",
        kanban: "📋 Kanban",
        health: "❤ Health",
        timeline: "🔍 Deep-Dive",
        feed: "🔄 Activity",
      };
      html += `<button class="tab${id === "gantt" || (id === "health" && !milestones.length) ? " active" : ""}" data-tab="${id}">${labels[id] || id}</button>`;
    }
    html += `</div>`;
  }

  // ── Gantt Tab ──
  if (milestones.length) {
    const active = !filterType || filterType === "all" || filterType === "gantt";
    html += `<div id="gantt" class="tab-content${active ? " active" : ""}">`;
    html += buildGanttSection(milestones);
    html += `</div>`;
  }

  // ── Kanban Tab ──
  if (features.length) {
    const active = filterType === "kanban";
    html += `<div id="kanban" class="tab-content${active ? " active" : ""}">`;
    html += buildKanbanSection(features);
    html += `</div>`;
  }

  // ── Health Tab ──
  {
    const active = filterType === "health" || (!milestones.length && !features.length);
    html += `<div id="health" class="tab-content${active ? " active" : ""}">`;
    html += buildHealthSection(p, roadblocks);
    html += `</div>`;
  }

  // ── Timeline Tab ──
  if (tasks.length) {
    const active = filterType === "timeline";
    html += `<div id="timeline" class="tab-content${active ? " active" : ""}">`;
    html += buildTimelineSection(milestones, tasks);
    html += `</div>`;
  }

  // ── Feed Tab ──
  if (workers.length) {
    const active = filterType === "feed";
    html += `<div id="feed" class="tab-content${active ? " active" : ""}">`;
    html += buildWorkerFeed(workers, sessions);
    html += `</div>`;
  }

  // ── Burndown chart (always in health tab or standalone card) ──
  if (tasks.length > 0) {
    html += `<div style="margin-top: 20px;">`;
    html += `<h2>📈 Task Burndown</h2>`;
    html += `<div class="card"><div class="chart-container"><canvas id="burndownChart"></canvas></div></div>`;
    html += `</div>`;
  }

  // ── Embedded data for charts ──
  html += `<script>
const PROJECT_DATA = ${JSON.stringify({
    milestones: milestones.map(m => ({ name: m.name, due: m.due, status: m.status, task_total: (m as any).task_total, task_done: (m as any).task_done })),
    tasks: tasks.map(t => ({ status: t.status, created_at: t.created_at, closed_at: t.closed_at })),
  })};
${tabScript(tabIds)}
</script>`;

  // ── Chart.js rendering ──
  html += buildChartJS(milestones, tasks);

  // ── Footer ──
  html += `<div style="margin-top: 30px; padding-top: 12px; border-top: 1px solid ${COLORS.border}; font-size: 10px; color: ${COLORS.textDim};">
  Generated: ${new Date().toISOString()} · <a href="#" onclick="location.reload()" style="color:${COLORS.accent}">Refresh</a>
</div>`;

  html += `\n</body>\n</html>`;
  return html;
}

// ══════════════════════════════════════════════════════════════
// PORTFOLIO DASHBOARD
// ══════════════════════════════════════════════════════════════

export function generatePortfolioDashboard(data: PortfolioDashboardData): string {
  const { projects, tree, unlinked, workers, timestamp } = data;

  const healthy = projects.filter((p) => p.health === "healthy").length;
  const attention = projects.filter((p) => p.health === "attention").length;
  const blocked = projects.filter((p) => p.health === "blocked" || p.health === "critical").length;
  const stale = projects.filter((p) => p.health === "stale").length;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PMM Portfolio Dashboard</title>
${CHART_JS_CDN}
<style>${SHARED_CSS}
.health-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; margin: 12px 0; }
.health-bar .seg { height: 100%; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>📊 PMM Portfolio</h1>
    <div class="header-info">${projects.length} active projects · ${tree.length} portfolio nodes</div>
  </div>
</div>

<div class="meta-bar">
  <span style="color:${COLORS.healthy}">● ${healthy} healthy</span>
  <span style="color:${COLORS.attention}">● ${attention} attention</span>
  <span style="color:${COLORS.blocked}">● ${blocked} blocked</span>
  <span style="color:${COLORS.stale}">● ${stale} stale</span>
  <span>🔄 ${workers.length} recent workers</span>
</div>

<div class="health-bar">
  ${healthy ? `<div class="seg" style="flex:${healthy};background:${COLORS.healthy}"></div>` : ""}
  ${attention ? `<div class="seg" style="flex:${attention};background:${COLORS.attention}"></div>` : ""}
  ${blocked ? `<div class="seg" style="flex:${blocked};background:${COLORS.blocked}"></div>` : ""}
  ${stale ? `<div class="seg" style="flex:${stale};background:${COLORS.stale}"></div>` : ""}
</div>

<!-- Tabs -->
<div class="tabs">
  <button class="tab active" data-tab="portfolio-tab">🏛 Portfolio Tree</button>
  <button class="tab" data-tab="health-tab">❤ Health Grid</button>
  <button class="tab" data-tab="feed-tab">🔄 Activity</button>
</div>`;

  // ── Portfolio Tree Tab ──
  html += `<div id="portfolio-tab" class="tab-content active">`;
  html += `<div class="card">`;
  html += buildPortfolioTree(tree, unlinked);
  html += `</div></div>`;

  // ── Health Grid Tab ──
  html += `<div id="health-tab" class="tab-content">`;
  html += `<div class="grid">`;
  for (const p of projects) {
    html += buildProjectCard(p);
  }
  html += `</div></div>`;

  // ── Activity Feed Tab ──
  html += `<div id="feed-tab" class="tab-content">`;
  html += buildWorkerFeed(workers, []);
  html += `</div>`;

  // ── Chart data ──
  let hc = 0, ac = 0, bc = 0, sc = 0;
  for (const p of projects) {
    const key = p.health === "critical" ? "blocked" : p.health;
    if (key === "healthy") hc++;
    else if (key === "attention") ac++;
    else if (key === "blocked") bc++;
    else sc++;
  }

  html += `<div style="margin-top: 20px;">
  <h2>📊 Health Distribution</h2>
  <div class="card" style="max-width:500px">
    <div class="chart-container"><canvas id="healthChart"></canvas></div>
  </div>
</div>`;

  html += `<script>
const HEALTH_DATA = ${JSON.stringify({ healthy, attention, blocked, stale })};
${tabScript(["portfolio-tab", "health-tab", "feed-tab"])}
</script>`;

  html += `<script>
new Chart(document.getElementById('healthChart'), {
  type: 'doughnut',
  data: {
    labels: ['Healthy', 'Attention', 'Blocked', 'Stale'],
    datasets: [{
      data: [${healthy}, ${attention}, ${blocked}, ${stale}],
      backgroundColor: ['${COLORS.healthy}', '${COLORS.attention}', '${COLORS.blocked}', '${COLORS.stale}'],
      borderWidth: 0
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '${COLORS.text}', font: { family: "'JetBrains Mono', monospace", size: 11 } } } }
  }
});
</script>`;

  html += `<div style="margin-top: 30px; padding-top: 12px; border-top: 1px solid ${COLORS.border}; font-size: 10px; color: ${COLORS.textDim};">
  Generated: ${timestamp} · <a href="#" onclick="location.reload()" style="color:${COLORS.accent}">Refresh</a>
</div>`;

  html += `\n</body>\n</html>`;
  return html;
}

// ══════════════════════════════════════════════════════════════
// LIVE DASHBOARD (SSE-powered)
// ══════════════════════════════════════════════════════════════

export function generateLiveDashboardHTML(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PMM Live Dashboard</title>
${CHART_JS_CDN}
<style>${SHARED_CSS}
.fade-in { animation: fadeIn 0.3s ease-in; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
#toast-container { position: fixed; top: 16px; right: 16px; z-index: 999; display: flex; flex-direction: column; gap: 6px; }
.toast {
  background: ${COLORS.surface}; border: 1px solid ${COLORS.accent}; border-radius: 6px;
  padding: 8px 14px; font-size: 11px; color: ${COLORS.text}; animation: fadeIn 0.2s ease-in;
  max-width: 360px;
}
</style>
</head>
<body>

<div id="toast-container"></div>

<div class="header">
  <div>
    <h1>⚡ PMM Live Dashboard</h1>
    <div class="header-info" id="connection-status">Connecting to SSE...</div>
  </div>
  <button class="reset-btn" onclick="location.reload()" style="margin-left:auto">↻ Refresh</button>
</div>

<div class="meta-bar">
  <span id="live-agents">🤖 Workers: —</span>
  <span id="live-events">📡 Events: 0</span>
  <span id="live-since">🕐 Connected: <span id="connected-at"></span></span>
</div>

<div class="tabs">
  <button class="tab active" data-tab="live-feed">🔄 Live Feed</button>
  <button class="tab" data-tab="live-health">❤ Health</button>
  <button class="tab" data-tab="live-workers">🤖 Workers</button>
</div>

<!-- Live Feed Tab -->
<div id="live-feed" class="tab-content active">
  <h2>Real-Time Activity</h2>
  <div class="card" id="feed-container">
    <div class="empty">Waiting for events...</div>
  </div>
</div>

<!-- Health Tab -->
<div id="live-health" class="tab-content">
  <h2>Portfolio Health</h2>
  <div class="grid" id="health-grid"><div class="empty">Waiting for data...</div></div>
</div>

<!-- Workers Tab -->
<div id="live-workers" class="tab-content">
  <h2>Agent Workers</h2>
  <div class="card" id="workers-container"><div class="empty">Waiting for data...</div></div>
</div>

<script>
const EVSSE = new EventSource("http://localhost:${port}/api/stream");
let eventCount = 0;

document.getElementById('connected-at').textContent = new Date().toLocaleTimeString();

EVSSE.onopen = () => {
  document.getElementById('connection-status').textContent = '🟢 Connected';
  document.getElementById('connection-status').style.color = '${COLORS.healthy}';
};

EVSSE.onerror = () => {
  document.getElementById('connection-status').textContent = '🔴 Disconnected';
  document.getElementById('connection-status').style.color = '${COLORS.blocked}';
};

EVSSE.addEventListener('worker:dispatched', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
  try {
    const d = JSON.parse(e.data);
    addFeedItem('🤖', d.agent_type || d.agent || 'agent', 'dispatched', d.project_name || d.project);
    updateWorkerCount();
  } catch(_) {}
});

EVSSE.addEventListener('worker:completed', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
  try {
    const d = JSON.parse(e.data);
    addFeedItem('✅', d.agent_type || d.agent || 'agent', 'completed', d.project_name || d.project);
  } catch(_) {}
});

EVSSE.addEventListener('worker:failed', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
  try {
    const d = JSON.parse(e.data);
    addFeedItem('❌', d.agent_type || d.agent || 'agent', 'failed', d.project_name || d.project);
  } catch(_) {}
});

EVSSE.addEventListener('session:started', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
  try {
    const d = JSON.parse(e.data);
    addFeedItem('📋', 'session', 'started', d.project_name || d.project);
  } catch(_) {}
});

EVSSE.addEventListener('session:ended', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
  try {
    const d = JSON.parse(e.data);
    addFeedItem('📋', 'session', 'ended', d.project_name || d.project);
    refreshHealth();
  } catch(_) {}
});

EVSSE.addEventListener('health:updated', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
  refreshHealth();
});

EVSSE.addEventListener('note:created', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
  try {
    const d = JSON.parse(e.data);
    addFeedItem('📝', d.title || 'note', 'created', d.target_type || '');
  } catch(_) {}
});

EVSSE.addEventListener('data:updated', (e) => {
  eventCount++;
  document.getElementById('live-events').textContent = '📡 Events: ' + eventCount;
});

function addFeedItem(icon, label, status, detail) {
  const feed = document.getElementById('feed-container');
  const empty = feed.querySelector('.empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'feed-item fade-in';
  const statusClass = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running';
  item.innerHTML = '<span>' + icon + '</span><span class="feed-status ' + statusClass + '"></span>' +
    '<span style="font-weight:600">' + escHtml(label) + '</span>' +
    '<span style="color:${COLORS.textDim}">' + escHtml(status) + '</span>' +
    (detail ? '<span style="color:${COLORS.textDim}">· ' + escHtml(detail) + '</span>' : '') +
    '<span style="color:${COLORS.textDim};margin-left:auto;font-size:10px">' + new Date().toLocaleTimeString() + '</span>';

  feed.insertBefore(item, feed.firstChild);

  // Keep max 50 items
  while (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

function updateWorkerCount() {
  document.getElementById('live-agents').textContent = '🤖 Workers: active';
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function refreshHealth() {
  fetch('http://localhost:${port}/api/data?type=health')
    .then(r => r.json())
    .then(d => {
      const grid = document.getElementById('health-grid');
      if (d.projects && d.projects.length) {
        grid.innerHTML = d.projects.map(p => {
          const colors = {healthy:'${COLORS.healthy}',attention:'${COLORS.attention}',blocked:'${COLORS.blocked}',stale:'${COLORS.stale}'};
          const c = colors[p.health] || '${COLORS.textDim}';
          return '<div class="card" style="border-left:3px solid ' + c + '">' +
            '<div class="card-title">' + escHtml(p.name) + '</div>' +
            '<div class="row"><span class="label">Health</span><span class="value" style="color:' + c + '">' + p.health + '</span></div>' +
            '<div class="row"><span class="label">Phase</span><span class="value">' + p.phase + '</span></div>' +
            '<div class="row"><span class="label">Priority</span><span class="value">' + p.priority + '</span></div>' +
            '<div class="row"><span class="label">Tasks</span><span class="value">' + p.task_count + ' · ' + p.completed_tasks + ' done</span></div>' +
            '<div class="row"><span class="label">Roadblocks</span><span class="value">' + p.open_roadblocks + '</span></div>' +
            '</div>';
        }).join('');
      }
    })
    .catch(() => {});
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Initial health load
setTimeout(refreshHealth, 500);

// Health refresh every 30s
setInterval(refreshHealth, 30000);

// Tab handling
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
  t.classList.add('active');
  const content = document.getElementById(t.dataset.tab);
  if (content) content.classList.add('active');
}));
<\/script>

</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════
// SECTION BUILDERS
// ══════════════════════════════════════════════════════════════

function buildGanttSection(milestones: any[]): string {
  if (!milestones.length) return '<div class="empty">No milestones</div>';

  const today = new Date();

  // Sort by due date
  const sorted = [...milestones].sort((a: any, b: any) => {
    if (!a.due) return 1; if (!b.due) return -1;
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });

  // Determine time range
  const dates = sorted.filter((m: any) => m.due).map((m: any) => new Date(m.due));
  if (!dates.length) return '<div class="empty">No milestones with dates</div>';

  const minDate = new Date(Math.min(...dates.map(d => d.getTime()), today.getTime()));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime()), today.getTime()));
  // Add padding
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);
  const range = maxDate.getTime() - minDate.getTime();

  function pct(date: string | null): number {
    if (!date) return 0;
    return ((new Date(date).getTime() - minDate.getTime()) / range) * 100;
  }

  const nowPct = ((today.getTime() - minDate.getTime()) / range) * 100;
  const showNow = nowPct > 0 && nowPct < 100;

  let html = `<h2>📊 Milestone Timeline</h2>
<div class="card">
  <div class="gantt-timeline">`;

  for (const m of sorted) {
    const donePct = (m as any).task_total > 0
      ? Math.round(((m as any).task_done / (m as any).task_total) * 100)
      : m.status === "completed" ? 100 : 0;
    const isOverdue = m.due && new Date(m.due) < today && m.status !== "completed";
    const barColor = m.status === "completed" ? COLORS.healthy
      : isOverdue ? COLORS.blocked
      : m.status === "in-progress" ? COLORS.accent
      : COLORS.textDim;

    html += `<div class="gantt-row">
      <div class="gantt-label" title="${escHtml(m.name)}">${escHtml(m.name)}</div>
      <div class="gantt-track">
        <div class="gantt-bar" style="width:${pct(m.due)}%;background:${barColor}"></div>
        ${showNow ? `<div class="gantt-now" style="left:${nowPct}%"></div>` : ""}
      </div>
      <div class="gantt-pct">${donePct}%</div>
    </div>`;
  }

  html += `</div>
  <div style="margin-top:8px;display:flex;gap:14px;font-size:10px;color:${COLORS.textDim}">
    <span>▬ ${COLORS.accent} In Progress</span>
    <span>▬ ${COLORS.healthy} Completed</span>
    <span>▬ ${COLORS.blocked} Overdue</span>
    <span style="margin-left:auto">Today: ${today.toISOString().slice(0, 10)}</span>
  </div>
</div>`;
  return html;
}

function buildKanbanSection(features: any[]): string {
  if (!features.length) return '<div class="empty">No features</div>';

  const planned = features.filter((f: any) => f.status === "planned");
  const inProgress = features.filter((f: any) => f.status === "in-progress");
  const done = features.filter((f: any) => f.status === "done");
  const blocked = features.filter((f: any) => f.status === "blocked");

  let html = `<h2>📋 Feature Board</h2>
<div class="kanban">
  <div class="kanban-col">
    <h4>📌 Planned (${planned.length})</h4>
    ${planned.map((f: any) => `<div class="kanban-card">
      <div style="font-weight:600">${escHtml(f.name)}</div>
      ${f.description ? `<div style="color:${COLORS.textDim};margin-top:2px">${escHtml(f.description).slice(0,100)}</div>` : ""}
      <div style="margin-top:4px"><span class="badge" style="background:${COLORS.border}">${f.priority}</span></div>
    </div>`).join("")}
    ${!planned.length ? '<div class="empty">None planned</div>' : ""}
  </div>
  <div class="kanban-col">
    <h4>🛠 Building (${inProgress.length + (blocked.length)})</h4>
    ${inProgress.map((f: any) => `<div class="kanban-card">
      <div style="font-weight:600">${escHtml(f.name)}</div>
      ${f.description ? `<div style="color:${COLORS.textDim};margin-top:2px">${escHtml(f.description).slice(0,100)}</div>` : ""}
      <div style="margin-top:4px"><span class="badge" style="background:${COLORS.accentDim}">building</span></div>
    </div>`).join("")}
    ${blocked.map((f: any) => `<div class="kanban-card" style="border-left:2px solid ${COLORS.blocked}">
      <div style="font-weight:600">${escHtml(f.name)}</div>
      <div style="margin-top:4px"><span class="badge" style="background:${COLORS.blocked}">blocked</span></div>
    </div>`).join("")}
    ${!inProgress.length && !blocked.length ? '<div class="empty">None in progress</div>' : ""}
  </div>
  <div class="kanban-col">
    <h4>✅ Done (${done.length})</h4>
    ${done.map((f: any) => `<div class="kanban-card" style="border-left:2px solid ${COLORS.healthy}">
      <div style="font-weight:600">${escHtml(f.name)}</div>
      ${f.description ? `<div style="color:${COLORS.textDim};margin-top:2px">${escHtml(f.description).slice(0,100)}</div>` : ""}
    </div>`).join("")}
    ${!done.length ? '<div class="empty">None completed</div>' : ""}
  </div>
</div>`;
  return html;
}

function buildHealthSection(project: ProjectSummary, roadblocks: any[]): string {
  const p = project;
  const hc = healthColor(p.health);
  const activeRb = roadblocks.filter((r: any) => !r.resolution);
  const staleWarn = p.last_active_days !== null && p.last_active_days > 7;

  let html = `<h2>❤ Project Health</h2>
<div class="grid">
  <div class="card" style="border-left:3px solid ${hc}">
    <div class="card-title">Status</div>
    <div class="row"><span class="label">Health</span><span class="value" style="color:${hc}">${p.health}</span></div>
    <div class="row"><span class="label">Phase</span><span class="value">${p.phase}</span></div>
    <div class="row"><span class="label">Priority</span><span class="value" style="color:${priorityColor(p.priority)}">${p.priority}</span></div>
    <div class="row"><span class="label">Last Active</span><span class="value" style="color:${staleWarn ? COLORS.attention : COLORS.text}">${p.last_active_days !== null ? p.last_active_days + " days ago" : "Never"}</span></div>
  </div>
  <div class="card">
    <div class="card-title">Progress</div>
    <div class="row"><span class="label">Milestones</span><span class="value">${p.milestone_count}</span></div>
    <div class="row"><span class="label">Features</span><span class="value">${p.feature_count}</span></div>
    <div class="row"><span class="label">Tasks</span><span class="value">${p.task_count} total · ${p.completed_tasks} done</span></div>
  </div>
  <div class="card" style="border-left:3px solid ${activeRb.length ? COLORS.blocked : COLORS.healthy}">
    <div class="card-title">Roadblocks</div>
    ${activeRb.length ? activeRb.map((r: any) => `<div class="row">
      <span class="label" style="color:${COLORS.blocked}">⚠ ${r.severity}</span>
      <span class="value" style="font-size:11px">${escHtml(r.description).slice(0,60)}</span>
    </div>`).join("") : `<div class="empty">No active roadblocks</div>`}
  </div>
</div>`;
  return html;
}

function buildTimelineSection(milestones: any[], tasks: any[]): string {
  const groupByMilestone = new Map<number | string, any[]>();
  const unassigned: any[] = [];

  for (const t of tasks) {
    const mid = (t as any).milestone_id || "none";
    if (mid === "none") { unassigned.push(t); continue; }
    if (!groupByMilestone.has(mid)) groupByMilestone.set(mid, []);
    groupByMilestone.get(mid)!.push(t);
  }

  let html = `<h2>🔍 Task Timeline</h2>
<div class="timeline">`;

  for (const ms of milestones) {
    const mtasks = groupByMilestone.get(ms.id) || [];
    const doneCount = mtasks.filter((t: any) => t.status === "done").length;
    const totalCount = mtasks.length;
    const pctDone = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

    const sDot = ms.status === "completed" ? "done" : ms.status === "in-progress" ? "in-progress" : ms.status === "blocked" ? "blocked" : "pending";

    html += `<div class="timeline-item">
      <div class="timeline-dot ${sDot}"></div>
      <div style="font-weight:600">${escHtml(ms.name)} <span style="color:${COLORS.textDim};font-size:11px">· ${ms.status} · ${pctDone}%</span></div>
      ${ms.due ? `<div style="font-size:10px;color:${COLORS.textDim}">Due: ${ms.due}</div>` : ""}
      ${mtasks.slice(0, 10).map((t: any) => {
        const tDot = t.status === "done" ? "done" : t.status === "in-progress" ? "in-progress" : t.status === "blocked" ? "blocked" : "pending";
        return `<div style="padding:2px 0 2px 16px;font-size:11px">
          <span class="timeline-dot ${tDot}" style="position:static;display:inline-block;width:6px;height:6px;margin-right:6px;vertical-align:middle"></span>
          ${escHtml(t.name)}
          ${(t as any).methods ? `<span style="color:${COLORS.accent};font-size:10px">· ${escHtml((t as any).methods)}</span>` : ""}
        </div>`;
      }).join("")}
      ${mtasks.length > 10 ? `<div style="color:${COLORS.textDim};font-size:10px;padding-left:16px">+ ${mtasks.length - 10} more tasks</div>` : ""}
    </div>`;
  }

  // Unassigned tasks
  if (unassigned.length) {
    html += `<div class="timeline-item">
      <div class="timeline-dot pending"></div>
      <div style="font-weight:600">Unassigned Tasks <span style="color:${COLORS.textDim};font-size:11px">· ${unassigned.length}</span></div>
      ${unassigned.slice(0, 5).map((t: any) => `<div style="padding:2px 0 2px 16px;font-size:11px">
        <span class="timeline-dot pending" style="position:static;display:inline-block;width:6px;height:6px;margin-right:6px;vertical-align:middle"></span>
        ${escHtml(t.name)} <span style="color:${COLORS.textDim}">· ${t.status}</span>
      </div>`).join("")}
    </div>`;
  }

  html += `</div>`;
  return html;
}

function buildWorkerFeed(workers: any[], sessions: any[]): string {
  let html = `<h2>🔄 Recent Activity</h2>
<div class="card">`;

  if (sessions.length) {
    html += `<div style="margin-bottom:12px">`;
    for (const s of sessions.slice(0, 5)) {
      html += `<div class="feed-item">
        <span>📋</span>
        <span style="font-weight:600">Session</span>
        <span>${s.started_at ? new Date(s.started_at + "Z").toLocaleDateString() : ""}</span>
        ${s.summary ? `<span style="color:${COLORS.textDim}">· ${escHtml(s.summary).slice(0, 80)}</span>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  if (workers.length) {
    for (const w of workers.slice(0, 30)) {
      const statusClass = w.status === "completed" ? "completed" : w.status === "running" || w.status === "in-progress" ? "running" : w.status === "failed" ? "failed" : "dispatched";
      const icon = w.status === "completed" ? "✅" : w.status === "running" ? "🤖" : w.status === "failed" ? "❌" : "🔄";

      html += `<div class="feed-item">
        <span>${icon}</span>
        <span class="feed-status ${statusClass}"></span>
        <span style="font-weight:600">${escHtml(w.agent_type)}</span>
        <span style="color:${COLORS.textDim}">${w.status}</span>
        ${w.project_name ? `<span style="color:${COLORS.textDim}">· ${escHtml(w.project_name)}</span>` : ""}
        ${w.started_at ? `<span style="color:${COLORS.textDim};margin-left:auto;font-size:10px">${new Date(w.started_at + "Z").toLocaleString()}</span>` : ""}
      </div>`;
    }
  } else {
    html += `<div class="empty">No recent activity</div>`;
  }

  html += `</div>`;
  return html;
}

function buildPortfolioTree(tree: any[], unlinked: any[]): string {
  function renderNode(node: any): string {
    const statusIcon = node.status === "active" ? "▣" : node.status === "completed" ? "✓" : "○";
    const statusColor = node.status === "active" ? COLORS.accent : node.status === "completed" ? COLORS.healthy : COLORS.textDim;
    const hasChildren = node.children?.length || node.projects?.length;

    let html = `<li>`;
    if (hasChildren) {
      html += `<span class="node-toggle" onclick="this.parentElement.querySelector('ul').classList.toggle('hidden');this.textContent=this.textContent==='▶'?'▼':'▶'">▼</span>`;
    } else {
      html += `<span class="node-toggle" style="visibility:hidden">▶</span>`;
    }
    html += `<span class="node-name" style="color:${statusColor}">${statusIcon} ${escHtml(node.type)}: ${escHtml(node.name)}</span>`;
    if (node.target_date) html += `<span class="node-meta">🎯 ${node.target_date}</span>`;
    html += `<span class="node-meta">${node.project_count} projects</span>`;

    if (hasChildren) {
      html += `<ul>`;
      if (node.projects) {
        for (const p of node.projects) {
          const hc = healthColor(p.health);
          html += `<li>
            <span class="node-toggle" style="visibility:hidden">▶</span>
            <span class="health-dot" style="background:${hc}"></span>
            <span class="node-name">${escHtml(p.name)}</span>
            <span class="node-meta">${p.phase} · ${p.priority} · ${p.task_count} tasks</span>
          </li>`;
        }
      }
      if (node.children) {
        for (const c of node.children) html += renderNode(c);
      }
      html += `</ul>`;
    }

    html += `</li>`;
    return html;
  }

  let html = `<div class="card-title">🏛 Portfolio Hierarchy</div>
<ul class="tree">`;
  for (const root of tree) html += renderNode(root);
  html += `</ul>`;

  if (unlinked.length) {
    html += `<div style="margin-top:14px"><div class="card-title">📌 Unlinked Projects</div>`;
    for (const p of unlinked) {
      const hc = healthColor(p.health);
      html += `<div class="row">
        <span class="health-dot" style="background:${hc}"></span>
        <span class="value">${escHtml(p.name)}</span>
        <span class="label">${p.phase} · ${p.priority}</span>
      </div>`;
    }
    html += `</div>`;
  }

  return html;
}

function buildProjectCard(p: ProjectSummary): string {
  const hc = healthColor(p.health);
  const circumference = 2 * Math.PI * 18;
  const score = p.health === "healthy" ? 85 : p.health === "attention" ? 60 : p.health === "blocked" ? 30 : 15;
  const offset = circumference - (score / 100) * circumference;
  const staleWarn = p.last_active_days !== null && p.last_active_days > 7;

  return `<div class="card" style="border-left:3px solid ${hc}">
    <div style="display:flex;align-items:center;gap:12px">
      <div class="gauge-ring" style="width:48px;height:48px;border:1px solid ${COLORS.border}">
        <svg width="48" height="48" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="18" fill="none" stroke="${COLORS.border}" stroke-width="3"/>
          <circle cx="24" cy="24" r="18" fill="none" stroke="${hc}" stroke-width="3"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
        </svg>
        <span class="score" style="font-size:12px;color:${hc}">${score}</span>
      </div>
      <div style="flex:1">
        <div style="font-weight:600">${escHtml(p.name)}</div>
        <div style="font-size:11px;color:${COLORS.textDim}">
          ${phaseIcon(p.phase)} ${p.phase}
          · <span style="color:${priorityColor(p.priority)}">${p.priority}</span>
          ${p.last_active_days !== null ? `· ${p.last_active_days}d ago` : ""}
        </div>
      </div>
    </div>
    <div style="margin-top:8px;display:flex;gap:10px;font-size:11px;color:${COLORS.textDim}">
      <span>🏁 ${p.milestone_count} milestones</span>
      <span>📊 ${p.task_count} tasks</span>
      <span>⚠ ${p.open_roadblocks} blockers</span>
    </div>
  </div>`;
}

function buildChartJS(milestones: any[], tasks: any[]): string {
  let html = `<script>
const ctx = document.getElementById('burndownChart');
if (ctx) {
  const ms = PROJECT_DATA.milestones;
  const ts = PROJECT_DATA.tasks;

  // Burndown: count done tasks over time
  const doneTasks = ts.filter(t => t.status === 'done' && t.closed_at);
  const doneByDate = {};
  for (const t of doneTasks) {
    const d = t.closed_at.slice(0, 10);
    doneByDate[d] = (doneByDate[d] || 0) + 1;
  }
  const dates = Object.keys(doneByDate).sort();
  let cumulative = 0;
  const burndownData = dates.map(d => {
    cumulative += doneByDate[d];
    return { date: d, completed: cumulative };
  });

  // Remaining (total - completed)
  const total = ts.length;

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: burndownData.map(d => d.date.slice(5)),
      datasets: [{
        label: 'Completed',
        data: burndownData.map(d => d.completed),
        borderColor: '${COLORS.healthy}',
        backgroundColor: '${COLORS.healthy}33',
        fill: true,
        tension: 0.3,
        pointRadius: 3
      }, {
        label: 'Remaining',
        data: burndownData.map(d => Math.max(0, total - d.completed)),
        borderColor: '${COLORS.blocked}',
        borderDash: [4, 4],
        tension: 0.3,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '${COLORS.text}', font: { family: "'JetBrains Mono', monospace", size: 11 } } }
      },
      scales: {
        x: { ticks: { color: '${COLORS.textDim}', font: { size: 10 } }, grid: { color: '${COLORS.border}' } },
        y: { beginAtZero: true, ticks: { color: '${COLORS.textDim}', font: { size: 10 } }, grid: { color: '${COLORS.border}' } }
      }
    }
  });
}
<\/script>`;
  return html;
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function escHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
