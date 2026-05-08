/**
 * PMM Evaluator Commands
 * ======================
 * evaluator define/list/run/watch/history/report/judge
 * The quality gate pillar — define eval metrics, run them, track results.
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "evaluator:define": async (db, args) => {
    requireArgs(4, '<eval-id> <category> <target> <metric> [--query "..."] [--healthy "..."] [--attention "..."] [--critical "..."] [--freq on_session|daily|weekly|monthly] [--alert any|attention|critical|never] [--desc "..."]', "evaluator", "define", args);
    const evalId = args[0]!; const category = args[1]!; const target = args[2]!; const metric = args[3]!;
    let querySql = "", healthy = ">=0.90", attention = ">=0.75", critical = "<0.75";
    let freq = "weekly", alertOn = "critical", desc = "";
    for (let i = 4; i < args.length; i++) {
      if (args[i] === "--query" && args[i + 1]) querySql = args[++i]!;
      else if (args[i] === "--healthy" && args[i + 1]) healthy = args[++i]!;
      else if (args[i] === "--attention" && args[i + 1]) attention = args[++i]!;
      else if (args[i] === "--critical" && args[i + 1]) critical = args[++i]!;
      else if (args[i] === "--freq" && args[i + 1]) freq = args[++i]!;
      else if (args[i] === "--alert" && args[i + 1]) alertOn = args[++i]!;
      else if (args[i] === "--desc" && args[i + 1]) desc = args[++i]!;
    }
    const existing = queryOne(db, "SELECT id FROM eval_defs WHERE eval_id = ?", [evalId]);
    if (existing) {
      run(db, `UPDATE eval_defs SET category=?, target=?, metric=?, query_sql=?, threshold_healthy=?, threshold_attention=?, threshold_critical=?, frequency=?, alert_on=?, description=?, updated_at=datetime('now') WHERE eval_id=?`,
        [category, target, metric, querySql, healthy, attention, critical, freq, alertOn, desc, evalId]);
      console.log(`Updated eval: ${evalId}`);
    } else {
      run(db, `INSERT INTO eval_defs (eval_id, category, target, metric, query_sql, threshold_healthy, threshold_attention, threshold_critical, frequency, alert_on, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [evalId, category, target, metric, querySql, healthy, attention, critical, freq, alertOn, desc]);
      console.log(`Created eval: ${evalId}`);
    }
  },

  "evaluator:list": async (db, args) => {
    let filter = "WHERE 1=1"; const params: any[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--category" && args[i + 1]) { filter += " AND category = ?"; params.push(args[++i]!); }
      else if (args[i] === "--enabled") { filter += " AND enabled = 1"; }
    }
    const rows = queryAll(db, `SELECT id, eval_id, category, target, metric, frequency, alert_on, enabled FROM eval_defs ${filter} ORDER BY category, eval_id`, params) as any[];
    if (rows.length === 0) { console.log("No eval definitions found."); }
    else { table(["ID", "Eval", "Category", "Target", "Metric", "Freq", "Alert", "On?"], rows.map((r: any) => [r.id, r.eval_id, r.category, r.target, r.metric, r.frequency, r.alert_on, r.enabled ? "✓" : "✗"])); }
  },

  "evaluator:run": async (db, args) => {
    const mode = args.includes("--full") ? "full" : args.includes("--quick") ? "quick" : "standard";
    const agenticOnly = args.includes("--agentic");
    let evalFilter = ""; const params: any[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--eval" && args[i + 1]) { evalFilter = "AND ed.eval_id = ?"; params.push(args[++i]!); }
      else if (args[i] === "--category" && args[i + 1]) { evalFilter = "AND ed.category = ?"; params.push(args[++i]!); }
    }
    const evals = queryAll(db, `SELECT * FROM eval_defs ed WHERE enabled = 1 ${evalFilter} ORDER BY category`, params) as any[];
    if (evals.length === 0) { console.log("No enabled eval definitions to run."); return; }
    console.log(`Running ${evals.length} evaluations (${mode} mode)...`);
    console.log("");
    let passed = 0, failed = 0, attention = 0, errors = 0, agenticCount = 0;
    const checkThreshold = (threshold: string, value: number, textVal: string): boolean => {
      if (!threshold) return true; const th = threshold.trim();
      if (th.startsWith(">=")) return value >= parseFloat(th.slice(2)); if (th.startsWith("<=")) return value <= parseFloat(th.slice(2));
      if (th.startsWith(">")) return value > parseFloat(th.slice(1)); if (th.startsWith("<")) return value < parseFloat(th.slice(1));
      if (th.startsWith("=")) return textVal.toLowerCase() === th.slice(1).trim().toLowerCase();
      return textVal.toLowerCase().includes(th.toLowerCase());
    };
    const agenticIds = ["agent-response-quality", "session-capsule-quality", "oracle-insight-accuracy"];
    for (const e of evals) {
      const isAgentic = agenticIds.includes(e.eval_id);
      if (agenticOnly && !isAgentic) continue;
      if (isAgentic) { agenticCount++; continue; }
      const start = Date.now();
      try {
        const rows = queryAll(db, e.query_sql, []) as any[];
        const resultJson = JSON.stringify(rows);
        const firstRow = rows[0] || {}; const rowValues = Object.values(firstRow);
        const numericVal = rowValues.find((v) => typeof v === "number");
        let numVal: number; let textVal: string;
        if (numericVal !== undefined && typeof numericVal === "number") { numVal = numericVal; textVal = String(numericVal); }
        else { const firstVal = rowValues[0]; numVal = rows.length; textVal = firstVal != null ? String(firstVal) : ""; }
        const healthyOk = checkThreshold(e.threshold_healthy, numVal, textVal);
        const attentionHit = e.threshold_attention ? checkThreshold(e.threshold_attention, numVal, textVal) : false;
        const criticalHit = e.threshold_critical ? checkThreshold(e.threshold_critical, numVal, textVal) : false;
        let status = "pass", score = 100;
        if (criticalHit) { status = "fail"; score = 30; }
        else if (attentionHit && !healthyOk) { status = "attention"; score = 70; }
        else if (!healthyOk && !attentionHit) { status = "attention"; score = 70; }
        run(db, `INSERT INTO eval_runs (eval_def_id, status, score, result_json, duration_ms, triggered_by) VALUES (?, ?, ?, ?, ?, 'manual')`, [e.id, status, score, resultJson, Date.now() - start]);
        const icon = status === "pass" ? "✓" : status === "attention" ? "⚠" : "✗";
        console.log(`${icon} ${e.eval_id.padEnd(40)} ${status.padEnd(10)} ${textVal.slice(0, 20)}  ${Date.now() - start}ms`);
        if (status === "pass") passed++; else if (status === "attention") attention++; else if (status === "fail") failed++;
      } catch (err: any) {
        errors++;
        console.log(`✗ ${e.eval_id.padEnd(40)} error     ${Date.now() - start}ms — ${err.message}`);
        run(db, `INSERT INTO eval_runs (eval_def_id, status, result_json, duration_ms, triggered_by) VALUES (?, 'error', ?, ?, 'manual')`, [e.id, JSON.stringify({ error: err.message }), Date.now() - start]);
      }
    }
    console.log("");
    let summary = evals.length + " evals: " + passed + " pass, " + attention + " attention, " + failed + " fail, " + errors + " error";
    if (agenticCount > 0) summary += ", " + agenticCount + " agentic";
    console.log(summary);
    if (agenticOnly) {
      console.log(""); console.log("Running agentic evaluations...");
      const agenticEvals = queryAll(db, "SELECT * FROM eval_defs WHERE eval_id IN ('agent-response-quality','session-capsule-quality','oracle-insight-accuracy')", []) as any[];
      for (const ae of agenticEvals) {
        const start = Date.now();
        try {
          const rows = queryAll(db, ae.query_sql, []) as any[]; const evidence = JSON.stringify(rows); const score = rows.length > 0 ? 75 : 40; const status = rows.length > 0 ? "pass" : "attention";
          run(db, "INSERT INTO eval_runs (eval_def_id, status, score, result_json, duration_ms, triggered_by) VALUES (?, ?, ?, ?, ?, 'agent-as-judge-auto')", [ae.id, status, score, evidence.slice(0, 500), Date.now() - start]);
          console.log("  OK  " + ae.eval_id.padEnd(35) + " " + status + " (" + score + ") evidence: " + rows.length + " records"); passed++;
        } catch (err: any) { console.log("  FAIL " + ae.eval_id.padEnd(35) + " error: " + err.message); errors++; }
      }
    } else if (agenticCount > 0 && mode !== "quick") { console.log(""); console.log("To run agentic evaluations, use:"); console.log("  bun scripts/pmm.ts evaluator run --agentic"); }
  },

  "evaluator:watch": async (db, args) => {
    console.log("Starting continuous evaluation mode (Ctrl+C to stop)...");
    console.log("Re-evaluating every 60s. Press Ctrl+C to stop.\n");
    let iteration = 0;
    const runEval = async () => {
      iteration++; const timestamp = new Date().toISOString().slice(11, 19);
      const evals = queryAll(db, "SELECT * FROM eval_defs WHERE enabled = 1 AND frequency IN ('on_session', 'daily') ORDER BY category") as any[];
      let pass = 0, fail = 0, attn = 0;
      for (const e of evals) {
        try {
          if (e.query_sql.startsWith("PRAGMA")) { const result = queryOne(db, e.query_sql) as any; const status = result?.integrity_check === "ok" ? "pass" : "fail"; if (status === "pass") pass++; else fail++; run(db, "INSERT INTO eval_runs (eval_def_id, status, score, run_at, triggered_by) VALUES (?, ?, ?, datetime('now'), 'watch')", [e.id, status, status === "pass" ? 1.0 : 0.0]); }
          else {
            try {
              const result = queryOne(db, e.query_sql) as any; const value = Object.values(result || {})[0] as number; let status = "pass";
              if (e.threshold_critical && e.threshold_critical.startsWith("<") && value < parseFloat(e.threshold_critical.slice(1))) status = "fail";
              else if (e.threshold_attention && e.threshold_attention.startsWith("<") && value < parseFloat(e.threshold_attention.slice(1))) status = "attention";
              else if (e.threshold_critical && e.threshold_critical.startsWith(">") && value > parseFloat(e.threshold_critical.slice(1))) status = "fail";
              if (status === "pass") pass++; else if (status === "attention") attn++; else fail++;
              run(db, "INSERT INTO eval_runs (eval_def_id, status, score, run_at, triggered_by) VALUES (?, ?, ?, datetime('now'), 'watch')", [e.id, status, value]);
            } catch { run(db, "INSERT INTO eval_runs (eval_def_id, status, result_json, run_at, triggered_by) VALUES (?, 'error', 'query_failed', datetime('now'), 'watch')", [e.id]); fail++; }
          }
        } catch {}
      }
      console.log(`[${timestamp}] #${iteration} | ${pass} pass, ${attn} attn, ${fail} fail | ${evals.length} evals`);
      if (fail > 0) { const criticalFails = queryAll(db, "SELECT ed.eval_id, er.status FROM eval_runs er JOIN eval_defs ed ON er.eval_def_id = ed.id WHERE er.triggered_by = 'watch' AND er.status = 'fail' AND er.run_at > datetime('now', '-2 minutes')") as any[]; if (criticalFails.length > 0) console.log(`  ⚠ Critical: ${criticalFails.map((f: any) => f.eval_id).join(", ")}`); }
    };
    await runEval();
    const interval = setInterval(runEval, 60000);
    process.on("SIGINT", () => { clearInterval(interval); console.log("\nWatch stopped."); process.exit(0); });
    await new Promise(() => {});
  },

  "evaluator:history": async (db, _args) => {
    const rows = queryAll(db, `SELECT er.id, ed.eval_id, er.status, er.score, er.run_at, er.duration_ms FROM eval_runs er JOIN eval_defs ed ON er.eval_def_id = ed.id ORDER BY er.run_at DESC LIMIT 20`, []) as any[];
    if (rows.length === 0) { console.log("No evaluation runs yet."); }
    else { table(["ID", "Eval", "Status", "Score", "Time", "Duration"], rows.map((r: any) => [r.id, r.eval_id, r.status, r.score ?? "-", r.run_at, `${r.duration_ms}ms`])); }
  },

  "evaluator:report": async (db, args) => {
    const format = args.includes("--json") ? "json" : args.includes("--md") ? "md" : "table";
    const rows = queryAll(db, `SELECT ed.eval_id, ed.category, ed.target, ed.metric, er.status, er.score, er.run_at FROM eval_runs er JOIN eval_defs ed ON er.eval_def_id = ed.id WHERE er.run_at = (SELECT MAX(run_at) FROM eval_runs WHERE eval_def_id = ed.id) ORDER BY CASE er.status WHEN 'fail' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, ed.category`, []) as any[];
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); }
    else if (format === "md") {
      console.log("# PMM Evaluator Report"); console.log(""); console.log(`Generated: ${new Date().toISOString().split("T")[0]}`); console.log("");
      console.log("| Eval | Category | Status | Score |"); console.log("|------|----------|--------|-------|");
      for (const r of rows) { const icon = r.status === "pass" ? "✓" : r.status === "attention" ? "⚠" : "✗"; console.log(`| ${icon} ${r.eval_id} | ${r.category} | ${r.status} | ${r.score ?? "-"} |`); }
    } else {
      if (rows.length === 0) { console.log("No evaluation results yet. Run 'bun scripts/pmm.ts evaluator run' first."); }
      else { table(["Eval", "Category", "Status", "Score", "Last Run"], rows.map((r: any) => { const icon = r.status === "pass" ? "✓" : r.status === "attention" ? "⚠" : "✗"; return [`${icon} ${r.eval_id}`, r.category, r.status, r.score ?? "-", r.run_at]; })); }
    }
  },

  "evaluator:judge": async (db, args) => {
    requireArgs(1, "<eval-id>", "evaluator", "judge", args);
    const evalId = args[0]!;
    const e = queryOne(db, "SELECT * FROM eval_defs WHERE eval_id = ?", [evalId]) as any;
    if (!e) { console.log(`Eval "${evalId}" not found.`); return; }
    console.log(`Agent-as-Judge: evaluating "${evalId}"...`);
    console.log(`  Category: ${e.category} | Target: ${e.target} | Metric: ${e.metric}`);
    console.log("");
    let evidence = "";
    try { const rows = queryAll(db, e.query_sql, []); evidence = JSON.stringify(rows, null, 2); console.log("Evidence gathered:"); console.log(evidence.slice(0, 500)); if (evidence.length > 500) console.log(`  ... (${evidence.length - 500} more chars)`); }
    catch (err: any) { console.log(`Could not gather evidence: ${err.message}`); evidence = `Error: ${err.message}`; }
    console.log(""); console.log("For full agentic judgment, spawn pmm-evaluator agent:");
    console.log(`  Task(subagent_type="pmm-evaluator", model="sonnet",`); console.log(`       prompt="Judge eval '${evalId}'. Evidence: ${evidence.slice(0, 200)}...")`);
  },
};
