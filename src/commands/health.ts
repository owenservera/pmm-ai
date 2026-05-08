/**
 * PMM Health + Check + Doctor Commands
 * =====================================
 * health — portfolio health overview
 * check — cross-pillar pipeline (Doctor + Evaluator + Oracle)
 * doctor — SENSE signals, diagnosis, healing, policy, history
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ health ══════════════════════════════════════════
  "health": async (db, _args) => {
    console.log("=== PMM Health Check ===\n");
    const projects = queryAll(db, "SELECT name, phase, priority, health FROM projects ORDER BY priority");
    console.log("--- Projects ---");
    for (const p of projects) {
      const icon = p.health === "healthy" ? "✓" : p.health === "attention" ? "⚠" : p.health === "blocked" ? "✗" : "○";
      console.log(`  ${icon} ${p.name} | ${p.phase} | ${p.priority} | ${p.health}`);
    }
    console.log("\n--- Stale Projects (>14d no activity) ---");
    const staleThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const stale = queryAll(db, "SELECT name, updated_at FROM projects WHERE updated_at < ? OR updated_at IS NULL", [staleThreshold]);
    if (stale.length) { for (const s of stale) console.log(`  ⚠ ${s.name} (last: ${s.updated_at || "never"})`); }
    else { console.log("  None"); }
    console.log("\n--- Inventory ---");
    const counts = {
      projects: projects.length,
      tools: (queryOne(db, "SELECT COUNT(*) as c FROM tooling") as any).c,
      subagents: (queryOne(db, "SELECT COUNT(*) as c FROM subagents") as any).c,
      hooks: (queryOne(db, "SELECT COUNT(*) as c FROM hooks") as any).c,
      pipelines: (queryOne(db, "SELECT COUNT(*) as c FROM pipelines") as any).c,
      mcp: (queryOne(db, "SELECT COUNT(*) as c FROM mcp_servers") as any).c,
      sessions: (queryOne(db, "SELECT COUNT(*) as c FROM sessions") as any).c,
    };
    console.log(`  Projects: ${counts.projects} | Tools: ${counts.tools} | Subagents: ${counts.subagents}`);
    console.log(`  Hooks: ${counts.hooks} | Pipelines: ${counts.pipelines} | MCP: ${counts.mcp} | Sessions: ${counts.sessions}`);
    const roots = queryAll(db, `SELECT id, type, name, status FROM portfolio_nodes WHERE parent_id IS NULL ORDER BY sort_order, id`);
    if (roots.length) {
      console.log("\n--- Roadmaps ---");
      for (const r of roots) {
        const subTotal = (queryOne(db, `WITH RECURSIVE subtree AS (SELECT id FROM portfolio_nodes WHERE id = ? UNION ALL SELECT n.id FROM portfolio_nodes n JOIN subtree s ON n.parent_id = s.id) SELECT COUNT(*) AS c FROM projects p WHERE p.node_id IN (SELECT id FROM subtree)`, [r.id]) as any).c;
        const icon = r.status === "active" ? "▣" : r.status === "completed" ? "✓" : "○";
        console.log(`  ${icon} ${r.name} | ${r.status} | ${subTotal} projects`);
      }
    }
    try {
      const { processScan } = await import("../process/scan");
      const ps = processScan();
      console.log(`\n--- Process ---`);
      console.log(`  Phase: ${ps.detected_phase} (${(ps.confidence * 100).toFixed(0)}%)`);
      console.log(`  Methods: ${ps.environment.active_methodologies.join(", ") || "none"}`);
      console.log(`  Artifacts: ${ps.artifacts.length} | Gaps: ${ps.gaps.length}`);
      if (ps.gaps.length > 0) { for (const g of ps.gaps) { const icon = g.auto_fixable ? "🔧" : "❓"; console.log(`    ${icon} ${g.type}: ${g.description}`); } }
    } catch { /* process awareness not available */ }
  },

  // ═══ check (cross-pillar) ═════════════════════════════
  "check": async (db, args) => {
    const fullMode = args.includes("--full"); const quickMode = args.includes("--quick");
    console.log("=== PMM Cross-Pillar Check " + (fullMode ? "(full)" : quickMode ? "(quick)" : "(standard)") + " ===");
    console.log("");
    console.log("--- Pillar 1: Doctor (Health) ---");
    const agentHealth = queryAll(db, "SELECT agent_type, COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM agent_workers WHERE started_at > datetime('now', '-7 days') GROUP BY agent_type", []) as any[];
    let agentIssues = 0;
    for (const a of agentHealth) { const rate = a.total > 0 ? a.completed / a.total : 1; if (rate < 0.9) { agentIssues++; console.log("  FAIL agent:" + a.agent_type + " rate=" + (rate * 100).toFixed(0) + "%"); } }
    const stuckWorkers = queryAll(db, "SELECT id FROM agent_workers WHERE status='running' AND started_at < datetime('now', '-30 minutes')", []) as any[];
    if (stuckWorkers.length > 0) console.log("  WARN " + stuckWorkers.length + " workers stuck");
    const integrity = queryOne(db, "PRAGMA integrity_check", []) as any;
    const dbOk = integrity.integrity_check === "ok";
    if (!dbOk) console.log("  FAIL db integrity: " + integrity.integrity_check);
    const doctorOk = agentIssues === 0 && stuckWorkers.length === 0 && dbOk;
    console.log("  Doctor: " + (doctorOk ? "OK" : "ISSUES FOUND"));

    console.log("");
    console.log("--- Pillar 2: Evaluator (Quality) ---");
    const evals = queryAll(db, "SELECT * FROM eval_defs WHERE enabled = 1 AND category != 'custom'", []) as any[];
    let evalPassed = 0, evalFailed = 0, evalAttn = 0;
    for (const e of evals) {
      try {
        const rows = queryAll(db, e.query_sql, []) as any[];
        const firstRow = rows[0] || {};
        const rowVals = Object.values(firstRow);
        const numVal = rowVals.find((v) => typeof v === "number");
        const val = numVal !== undefined && typeof numVal === "number" ? numVal : rows.length;
        const txt = numVal !== undefined ? String(numVal) : String(rowVals[0] || "");
        const checkT = (th: string, v: number, t: string): boolean => { if (!th) return true; const th2 = th.trim(); if (th2.startsWith(">=")) return v >= parseFloat(th2.slice(2)); if (th2.startsWith("<=")) return v <= parseFloat(th2.slice(2)); if (th2.startsWith(">")) return v > parseFloat(th2.slice(1)); if (th2.startsWith("<")) return v < parseFloat(th2.slice(1)); if (th2.startsWith("=")) return t.toLowerCase() === th2.slice(1).trim().toLowerCase(); return t.toLowerCase().includes(th2.toLowerCase()); };
        const healthyOk = checkT(e.threshold_healthy, val, txt);
        const criticalHit = e.threshold_critical ? checkT(e.threshold_critical, val, txt) : false;
        if (criticalHit) evalFailed++;
        else if (!healthyOk) evalAttn++;
        else evalPassed++;
        if (fullMode && criticalHit) console.log("  FAIL " + e.eval_id + " value=" + txt);
      } catch (_) { evalFailed++; }
    }
    const evalOk = evalFailed === 0;
    console.log("  Evaluator: " + evalPassed + " pass, " + evalAttn + " attn, " + evalFailed + " fail");

    console.log("");
    console.log("--- Pillar 3: Oracle (Insights) ---");
    const insights = queryAll(db, "SELECT COUNT(*) as c FROM oracle_insights WHERE created_at > datetime('now', '-7 days')", []) as any[];
    const insightCount = insights[0]?.c || 0;
    const healActions = queryAll(db, "SELECT COUNT(*) as c FROM doctor_actions WHERE color IN ('green','yellow') AND needs_approval = 0", []) as any[];
    const healReady = healActions[0]?.c || 0;
    console.log("  Insights (7d): " + insightCount + " | Heal actions ready: " + healReady);

    if (evalFailed > 0 && fullMode) {
      const existing = queryOne(db, "SELECT id FROM oracle_insights WHERE title = 'Repeated evaluation failures' AND created_at > datetime('now', '-1 days')", []) as any;
      if (!existing) { run(db, "INSERT INTO oracle_insights (category, title, description, evidence_json, source, confidence, status, impact_score) VALUES ('observation', 'Repeated evaluation failures', ?, ?, 'cross-pillar-evaluator', 0.85, 'new', 0.7)", [evalFailed + " evaluations failing in latest run", JSON.stringify({ evalFailed, evalPassed, evalAttn, timestamp: new Date().toISOString() })]); console.log("  -> Cross-pillar: " + evalFailed + " eval failures recorded as oracle insight"); }
    }
    if (!doctorOk && fullMode) {
      const existing = queryOne(db, "SELECT id FROM oracle_insights WHERE title = 'Platform health degradation' AND created_at > datetime('now', '-1 days')", []) as any;
      if (!existing) { run(db, "INSERT INTO oracle_insights (category, title, description, evidence_json, source, confidence, status, impact_score) VALUES ('observation', 'Platform health degradation', ?, ?, 'cross-pillar-doctor', 0.9, 'new', 0.8)", ["Doctor detected issues: " + agentIssues + " agent problems, " + stuckWorkers.length + " stuck workers", JSON.stringify({ agentIssues, stuckWorkers: stuckWorkers.length, dbOk, timestamp: new Date().toISOString() })]); console.log("  -> Cross-pillar: Doctor issues recorded as oracle insight"); }
    }
    console.log("");
    console.log("=== Summary ===");
    const allOk = doctorOk && evalOk;
    console.log("  Status: " + (allOk ? "HEALTHY" : "NEEDS ATTENTION"));
    if (!allOk) {
      console.log("  Actions available:");
      if (!doctorOk) console.log("    - bun scripts/pmm.ts doctor diagnose");
      if (!evalOk) console.log("    - bun scripts/pmm.ts evaluator run --quick");
      if (healReady > 0) console.log("    - bun scripts/pmm.ts doctor heal --auto  (" + healReady + " actions ready)");
      console.log("    - bun scripts/pmm.ts oracle brief");
      console.log("  Or run: bun scripts/pmm.ts check --full");
    }
    try {
      const { processScan } = await import("../process/scan");
      const ps = processScan();
      console.log(`\n--- Process ---`);
      console.log(`  Phase: ${ps.detected_phase} (${(ps.confidence * 100).toFixed(0)}%)`);
      console.log(`  Methods: ${ps.environment.active_methodologies.join(", ") || "none"}`);
      console.log(`  Artifacts: ${ps.artifacts.length} | Gaps: ${ps.gaps.length}`);
      if (ps.gaps.length > 0) { for (const g of ps.gaps) { const icon = g.auto_fixable ? "🔧" : "❓"; console.log(`    ${icon} ${g.type}: ${g.description}`); } }
    } catch { /* not available */ }
  },

  // ═══ doctor ═══════════════════════════════════════════
  "doctor:check": async (db, args) => {
    const deep = args.includes("--deep");
    console.log("PMM Doctor — Health Diagnostic");
    console.log("");
    const signals: { name: string; status: string; detail: string }[] = [];
    const agentHealth = queryAll(db, `SELECT agent_type, COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed FROM agent_workers WHERE started_at > datetime('now', '-7 days') GROUP BY agent_type`, []) as any[];
    for (const a of agentHealth) { const rate = a.total > 0 ? a.completed / a.total : 1; signals.push({ name: `agent:${a.agent_type}`, status: rate >= 0.9 ? "healthy" : rate >= 0.75 ? "attention" : "critical", detail: `${a.completed}/${a.total} completed (${(rate * 100).toFixed(0)}%)` }); }
    const integrity = queryOne(db, "PRAGMA integrity_check", []) as any;
    signals.push({ name: "db:integrity", status: integrity.integrity_check === "ok" ? "healthy" : "critical", detail: integrity.integrity_check });
    const staleProjects = queryAll(db, `SELECT name FROM projects WHERE status = 'active' AND name NOT IN (SELECT DISTINCT p.name FROM projects p JOIN sessions s ON p.id = s.project_id WHERE s.started_at > datetime('now', '-14 days'))`, []) as any[];
    signals.push({ name: "projects:staleness", status: staleProjects.length === 0 ? "healthy" : staleProjects.length <= 2 ? "attention" : "critical", detail: staleProjects.length === 0 ? "none stale" : `${staleProjects.length} stale: ${staleProjects.map((s: any) => s.name).join(", ")}` });
    const sessions = queryOne(db, `SELECT COUNT(*) as total, SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) as completed FROM sessions WHERE started_at > datetime('now', '-7 days')`, []) as any;
    const sessionRate = sessions.total > 0 ? sessions.completed / sessions.total : 1;
    signals.push({ name: "sessions:completion", status: sessionRate >= 0.85 ? "healthy" : sessionRate >= 0.7 ? "attention" : "critical", detail: `${sessions.completed}/${sessions.total} completed (${(sessionRate * 100).toFixed(0)}%)` });
    const stuckWorkers = queryAll(db, `SELECT id, agent_type, status FROM agent_workers WHERE status = 'running' AND started_at < datetime('now', '-30 minutes')`, []) as any[];
    signals.push({ name: "workers:stuck", status: stuckWorkers.length === 0 ? "healthy" : "critical", detail: stuckWorkers.length === 0 ? "none stuck" : `${stuckWorkers.length} stuck >30min` });
    const hookCount = (queryOne(db, "SELECT COUNT(*) as c FROM hook_handlers", []) as any).c;
    signals.push({ name: "hooks:registered", status: hookCount >= 8 ? "healthy" : hookCount >= 4 ? "attention" : "critical", detail: `${hookCount} hooks registered` });
    for (const s of signals) { const icon = s.status === "healthy" ? "✓" : s.status === "attention" ? "⚠" : "✗"; console.log(`${icon} ${s.name.padEnd(30)} ${s.detail}`); }
    const criticalCount = signals.filter((s) => s.status === "critical").length;
    const attentionCount = signals.filter((s) => s.status === "attention").length;
    const healthyCount = signals.filter((s) => s.status === "healthy").length;
    console.log("");
    console.log(`${signals.length} signals: ${healthyCount} healthy, ${attentionCount} attention, ${criticalCount} critical`);
    let autoRegistered = 0;
    for (const s of signals) {
      if (s.status !== "critical") continue;
      const actionType = `fix_${s.name.replace(/[:.]/g, "_")}`;
      const existing = queryOne(db, "SELECT id FROM doctor_actions WHERE action_type = ?", [actionType]);
      if (!existing) {
        let color = "yellow", blast = "single-component", rev = 0, auto = 0, approval = 0;
        if (s.name === "workers:stuck") { color = "green"; rev = 1; auto = 1; blast = "single-worker"; }
        else if (s.name === "db:integrity") { color = "red"; blast = "all-data"; approval = 1; }
        else if (s.name === "hooks:registered") { color = "red"; approval = 1; }
        run(db, `INSERT INTO doctor_actions (action_type, color, target, diagnosis, confidence, blast_radius, reversible, auto_execute, needs_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [actionType, color, s.name, `Auto-detected: ${s.name} critical — ${s.detail}`, color === "green" ? 0.95 : 0.8, blast, rev, auto, approval]);
        autoRegistered++;
      }
    }
    if (autoRegistered > 0) console.log(`  ↳ ${autoRegistered} new doctor actions auto-registered.`);
    if (deep) { console.log(""); console.log("Deep diagnostic: spawn pmm-health-scorer with diagnostic mode via pmm-health skill."); }
  },

  "doctor:heal": async (db, args) => {
    requireArgs(0, "[--all] [--dry-run] [--auto] [--force]", "doctor", "heal", args);
    const healAll = args.includes("--all"); const dryRun = args.includes("--dry-run");
    const autoMode = args.includes("--auto"); const force = args.includes("--force");
    let query = "SELECT * FROM doctor_actions WHERE 1=1";
    if (!healAll && !autoMode && !force) query += " AND color = 'green'";
    else if (autoMode) query += " AND color IN ('green', 'yellow') AND confidence >= 0.75";
    if (!force) query += " AND needs_approval = 0";
    query += " ORDER BY CASE color WHEN 'green' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, confidence DESC";
    const allActions = queryAll(db, query, []) as any[];
    if (allActions.length === 0) { console.log("No healable actions found. Run 'bun scripts/pmm.ts doctor diagnose' to detect issues."); return; }
    const LIMITS = { max_total: 3, max_yellow: 1 };
    const toExecute: any[] = [], blocked: any[] = [];
    let yellowCount = 0;
    for (const a of allActions) {
      if (toExecute.length >= LIMITS.max_total) { blocked.push({ ...a, reason: "Circuit breaker: max 3/run" }); continue; }
      if (a.color === "yellow" && yellowCount >= LIMITS.max_yellow) { blocked.push({ ...a, reason: "Yellow limit: max 1/run" }); continue; }
      if (a.color === "red" && !force) { blocked.push({ ...a, reason: "Red requires --force" }); continue; }
      if (a.blast_radius === "multi-project" || a.blast_radius === "all-data") { blocked.push({ ...a, reason: `Blast radius '${a.blast_radius}' requires approval` }); continue; }
      toExecute.push(a);
      if (a.color === "yellow") yellowCount++;
    }
    const greenCount = toExecute.filter((a) => a.color === "green").length;
    if (dryRun) {
      console.log(`[DRY RUN] Policy: ${toExecute.length} execute (${greenCount} green, ${yellowCount} yellow), ${blocked.length} blocked`);
      console.log("");
      for (const a of toExecute) { const icon = a.color === "green" ? "🟢" : a.color === "yellow" ? "🟡" : "🔴"; console.log(`  ${icon} ${a.action_type.padEnd(40)} ${a.target} (conf: ${(a.confidence ?? 1).toFixed(2)})`); }
      if (blocked.length > 0) { console.log(""); console.log("Blocked:"); for (const b of blocked) console.log(`  ✕ ${b.action_type.padEnd(40)} ${b.reason}`); }
      return;
    }
    console.log(`Healing ${toExecute.length} actions (${greenCount} green, ${yellowCount} yellow)...`);
    console.log("");
    let healed = 0, failed = 0;
    for (const a of toExecute) {
      const start = Date.now();
      const snapshot = JSON.stringify({ action: a.action_type, target: a.target, at: new Date().toISOString() });
      try {
        if (a.action_type.startsWith("fix_workers_stuck")) {
          const reset = db.prepare(`UPDATE agent_workers SET status = 'failed', result_summary = COALESCE(result_summary,'') || ' [auto-reset by doctor]' WHERE status = 'running' AND started_at < datetime('now', '-30 minutes')`);
          const r = reset.run();
          if (r.changes === 0) throw new Error("No stuck workers to reset (race condition)");
        }
        run(db, `INSERT INTO heal_log (action_id, status, snapshot_json, duration_ms) VALUES (?, 'success', ?, ?)`, [a.id, snapshot, Date.now() - start]);
        healed++;
        const icon = a.color === "green" ? "🟢" : "🟡";
        console.log(`${icon} ${a.action_type.padEnd(40)} healed  ${Date.now() - start}ms`);
      } catch (err: any) {
        failed++;
        run(db, `INSERT INTO heal_log (action_id, status, snapshot_json, error_message, duration_ms) VALUES (?, 'failed', ?, ?, ?)`, [a.id, snapshot, err.message, Date.now() - start]);
        console.log(`✕ ${a.action_type.padEnd(40)} FAILED  ${err.message}`);
      }
    }
    console.log("");
    console.log(`Result: ${healed} healed, ${failed} failed, ${blocked.length} blocked`);
    if (blocked.length > 0) { console.log("Blocked (needs review):"); for (const b of blocked) console.log(`  • ${b.action_type}: ${b.reason}`); }
  },

  "doctor:history": async (db, _args) => {
    const rows = queryAll(db, `SELECT hl.id, da.action_type, da.color, hl.status, hl.executed_at, hl.error_message FROM heal_log hl JOIN doctor_actions da ON hl.action_id = da.id ORDER BY hl.executed_at DESC LIMIT 20`, []) as any[];
    if (rows.length === 0) { console.log("No heal actions recorded yet."); }
    else { table(["ID", "Action", "Color", "Status", "Time", "Error"], rows.map((r: any) => [r.id, r.action_type, r.color, r.status, r.executed_at, r.error_message || ""])); }
  },

  "doctor:policy": async (db, _args) => {
    const actions = queryAll(db, "SELECT * FROM doctor_actions ORDER BY color, action_type", []) as any[];
    if (actions.length === 0) { console.log("No doctor actions defined yet. Actions are auto-registered as platform issues are detected."); }
    else { table(["ID", "Color", "Action", "Target", "Confidence", "Auto?"], actions.map((a: any) => [a.id, a.color, a.action_type, a.target, a.confidence.toFixed(2), a.auto_execute ? "yes" : "no"])); }
  },

  "doctor:diagnose": async (db, _args) => {
    console.log("PMM Doctor — Diagnostic Analysis");
    console.log("");
    const sigs: { name: string; status: string; detail: string }[] = [];
    const agentHealth = queryAll(db, `SELECT agent_type, COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM agent_workers WHERE started_at > datetime('now', '-7 days') GROUP BY agent_type`, []) as any[];
    for (const a of agentHealth) { const rate = a.total > 0 ? a.completed / a.total : 1; sigs.push({ name: `agent:${a.agent_type}`, status: rate >= 0.9 ? "healthy" : rate >= 0.75 ? "attention" : "critical", detail: `${a.completed}/${a.total} (${(rate * 100).toFixed(0)}%)` }); }
    const integrity = queryOne(db, "PRAGMA integrity_check", []) as any;
    sigs.push({ name: "db:integrity", status: integrity.integrity_check === "ok" ? "healthy" : "critical", detail: integrity.integrity_check });
    const staleProjects = queryAll(db, `SELECT name FROM projects WHERE status = 'active' AND name NOT IN (SELECT DISTINCT p.name FROM projects p JOIN sessions s ON p.id = s.project_id WHERE s.started_at > datetime('now', '-14 days'))`, []) as any[];
    sigs.push({ name: "projects:staleness", status: staleProjects.length === 0 ? "healthy" : staleProjects.length <= 2 ? "attention" : "critical", detail: `${staleProjects.length} stale` });
    const sessions = queryOne(db, `SELECT CAST(SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) as rate FROM sessions WHERE started_at > datetime('now', '-7 days')`, []) as any;
    const sRate = sessions?.rate ?? 1;
    sigs.push({ name: "sessions:completion", status: sRate >= 0.85 ? "healthy" : sRate >= 0.7 ? "attention" : "critical", detail: `${(sRate * 100).toFixed(0)}%` });
    const stuckWorkers = queryAll(db, `SELECT id, agent_type FROM agent_workers WHERE status = 'running' AND started_at < datetime('now', '-30 minutes')`, []) as any[];
    sigs.push({ name: "workers:stuck", status: stuckWorkers.length === 0 ? "healthy" : "critical", detail: `${stuckWorkers.length} stuck` });
    const hookCount = (queryOne(db, "SELECT COUNT(*) as c FROM hook_handlers", []) as any).c;
    sigs.push({ name: "hooks:registered", status: hookCount >= 8 ? "healthy" : hookCount >= 4 ? "attention" : "critical", detail: `${hookCount} hooks` });
    console.log("═══ Symptom Clusters ═══");
    console.log("");
    const critical = sigs.filter((s) => s.status === "critical");
    const agentCluster = critical.filter((s) => s.name.startsWith("agent:") || s.name === "workers:stuck");
    if (agentCluster.length > 0) { console.log("Cluster 1: Agent Infrastructure Issue"); console.log(`  Signals: ${agentCluster.map((s) => s.name).join(", ")}`); console.log("  Hypothesis: MCP connectivity, API rate limiting, or hook timeout"); console.log("  Action: Verify MCP server status, check API keys, review hook timeouts"); console.log(""); }
    const engagementCluster = critical.filter((s) => s.name === "sessions:completion" || s.name === "projects:staleness");
    if (engagementCluster.length > 0) { console.log("Cluster 2: Engagement / Monitoring Gap"); console.log(`  Signals: ${engagementCluster.map((s) => s.name).join(", ")}`); console.log("  Hypothesis: Missing SessionEnd hooks or inactive projects"); console.log("  Action: Verify hooks firing, run pmm-capture for unclosed sessions"); console.log(""); }
    const dataCluster = critical.filter((s) => s.name === "db:integrity");
    if (dataCluster.length > 0) { console.log("Cluster 3: Data Integrity Risk"); console.log("  Hypothesis: Corrupted write, disk full, or concurrent access conflict"); console.log("  Action: Backup DB immediately, run PRAGMA integrity_check, check disk space"); console.log(""); }
    if (critical.length === 0) { console.log("All signals healthy — no clusters detected."); }
    let registered = 0;
    for (const s of critical) {
      const actionType = `fix_${s.name.replace(/[:.]/g, "_")}`;
      const existing = queryOne(db, "SELECT id FROM doctor_actions WHERE action_type = ?", [actionType]);
      if (!existing) {
        let color = "yellow", blast = "single-component", rev = 0, auto = 0, approval = 0;
        if (s.name === "workers:stuck" && stuckWorkers.length <= 2) { color = "green"; rev = 1; auto = 1; }
        else if (s.name === "db:integrity") { color = "red"; blast = "all-data"; approval = 1; }
        else if (s.name === "hooks:registered") { color = "red"; approval = 1; }
        else if (s.name.startsWith("agent:")) { color = "yellow"; }
        run(db, `INSERT INTO doctor_actions (action_type, color, target, diagnosis, confidence, blast_radius, reversible, auto_execute, needs_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [actionType, color, s.name, `${s.name} critical: ${s.detail}`, color === "green" ? 0.95 : 0.8, blast, rev, auto, approval]);
        registered++;
      }
    }
    if (registered > 0) console.log(`  ↳ ${registered} actions auto-registered. Review: bun scripts/pmm.ts doctor policy`);
  },

  // ═══ health:triage ════════════════════════════════════
  "health:triage": async (db, _args) => {
    const { badge, divider } = await import("./shared");

    // ── collect signals ──
    type Signal = { name: string; status: "healthy" | "attention" | "critical"; detail: string; fix?: string };
    const signals: Signal[] = [];

    const agentHealth = queryAll(db, `SELECT agent_type, COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM agent_workers WHERE started_at > datetime('now', '-7 days') GROUP BY agent_type`, []) as any[];
    for (const a of agentHealth) {
      const rate = a.total > 0 ? a.completed / a.total : 1;
      signals.push({
        name: `agent:${a.agent_type}`,
        status: rate >= 0.9 ? "healthy" : rate >= 0.75 ? "attention" : "critical",
        detail: `${a.completed}/${a.total} completed (${(rate * 100).toFixed(0)}%)`,
        fix: rate < 0.9 ? `bun scripts/cli.ts doctor diagnose` : undefined,
      });
    }

    const integrity = queryOne(db, "PRAGMA integrity_check", []) as any;
    const dbOk = integrity.integrity_check === "ok";
    signals.push({
      name: "db:integrity",
      status: dbOk ? "healthy" : "critical",
      detail: dbOk ? "ok" : integrity.integrity_check,
      fix: dbOk ? undefined : "BACKUP data/pmm.db immediately, then: bun scripts/cli.ts doctor diagnose",
    });

    const staleProjects = queryAll(db, `SELECT name FROM projects WHERE status = 'active' AND name NOT IN (SELECT DISTINCT p.name FROM projects p JOIN sessions s ON p.id = s.project_id WHERE s.started_at > datetime('now', '-14 days'))`, []) as any[];
    signals.push({
      name: "projects:staleness",
      status: staleProjects.length === 0 ? "healthy" : staleProjects.length <= 2 ? "attention" : "critical",
      detail: staleProjects.length === 0 ? "all projects active" : `${staleProjects.length} stale: ${staleProjects.map((s: any) => s.name).join(", ")}`,
      fix: staleProjects.length > 0 ? `bun scripts/cli.ts project list` : undefined,
    });

    const sessions = queryOne(db, `SELECT COUNT(*) as total, SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) as completed FROM sessions WHERE started_at > datetime('now', '-7 days')`, []) as any;
    const sessionRate = sessions.total > 0 ? sessions.completed / sessions.total : 1;
    signals.push({
      name: "sessions:completion",
      status: sessionRate >= 0.85 ? "healthy" : sessionRate >= 0.7 ? "attention" : "critical",
      detail: `${sessions.completed ?? 0}/${sessions.total} closed (${(sessionRate * 100).toFixed(0)}%)`,
      fix: sessionRate < 0.85 ? `bun scripts/cli.ts session list` : undefined,
    });

    const stuckWorkers = queryAll(db, `SELECT id, agent_type FROM agent_workers WHERE status = 'running' AND started_at < datetime('now', '-30 minutes')`, []) as any[];
    signals.push({
      name: "workers:stuck",
      status: stuckWorkers.length === 0 ? "healthy" : "critical",
      detail: stuckWorkers.length === 0 ? "none stuck" : `${stuckWorkers.length} stuck >30min`,
      fix: stuckWorkers.length > 0 ? `bun scripts/cli.ts doctor heal --auto` : undefined,
    });

    const hookCount = (queryOne(db, "SELECT COUNT(*) as c FROM hook_handlers", []) as any).c;
    signals.push({
      name: "hooks:registered",
      status: hookCount >= 8 ? "healthy" : hookCount >= 4 ? "attention" : "critical",
      detail: `${hookCount} hooks registered`,
      fix: hookCount < 8 ? `bun scripts/cli.ts health  # check harness hook setup` : undefined,
    });

    // ── open decisions & roadblocks ──
    const openDecisions = (queryOne(db, "SELECT COUNT(*) as c FROM decisions WHERE status = 'open'", []) as any).c;
    const activeRoadblocks = (queryOne(db, "SELECT COUNT(*) as c FROM roadblocks WHERE resolved_at IS NULL", []) as any).c;

    // ── auto-heal actions ready ──
    const healReady = (queryOne(db, "SELECT COUNT(*) as c FROM doctor_actions WHERE color IN ('green','yellow') AND needs_approval = 0", []) as any).c;

    // ── render ──
    const criticalSigs = signals.filter(s => s.status === "critical");
    const attentionSigs = signals.filter(s => s.status === "attention");
    const healthySigs = signals.filter(s => s.status === "healthy");

    console.log(`\n${badge("═══ PMM Health Triage ═══", "blue")}  ${new Date().toLocaleTimeString()}\n`);

    if (criticalSigs.length) {
      console.log(badge("  🔴 CRITICAL — fix now", "red"));
      divider("", 54);
      for (const s of criticalSigs) {
        console.log(`  ✗  ${badge(s.name.padEnd(28), "red")} ${s.detail}`);
        if (s.fix) console.log(`     ${badge("FIX:", "dim")} ${s.fix}`);
      }
      console.log("");
    }

    if (attentionSigs.length) {
      console.log(badge("  🟡 ATTENTION — review when possible", "yellow"));
      divider("", 54);
      for (const s of attentionSigs) {
        console.log(`  ⚠  ${badge(s.name.padEnd(28), "yellow")} ${s.detail}`);
        if (s.fix) console.log(`     ${badge("SEE:", "dim")} ${s.fix}`);
      }
      console.log("");
    }

    if (healthySigs.length) {
      console.log(badge("  🟢 HEALTHY", "green"));
      divider("", 54);
      console.log(`     ${healthySigs.map(s => s.name).join("  ·  ")}`);
      console.log("");
    }

    // ── project planning state ──
    if (openDecisions > 0 || activeRoadblocks > 0) {
      console.log(`  ${badge("PLANNING", "blue")}`);
      divider("", 54);
      if (openDecisions > 0) console.log(`  ○  ${badge("decisions:open", "yellow").padEnd(36)}  ${openDecisions} undecided   → bun scripts/cli.ts decision review <project>`);
      if (activeRoadblocks > 0) console.log(`  ⚠  ${badge("roadblocks:active", "yellow").padEnd(36)}  ${activeRoadblocks} unresolved  → bun scripts/cli.ts roadblock list <project> --active`);
      console.log("");
    }

    // ── summary line ──
    const summaryColor = criticalSigs.length ? "red" : attentionSigs.length ? "yellow" : "green";
    const summaryIcon = criticalSigs.length ? "✗" : attentionSigs.length ? "⚠" : "✓";
    console.log(`  ${badge(`${summaryIcon} ${criticalSigs.length} critical · ${attentionSigs.length} attention · ${healthySigs.length} healthy`, summaryColor)}`);

    if (healReady > 0) {
      console.log(`\n  ${badge(`Quick fix available (${healReady} auto-heal action${healReady !== 1 ? "s" : ""} ready):`, "green")}`);
      console.log(`    bun scripts/cli.ts doctor heal --auto --dry-run`);
    }
    console.log("");
  },
};
