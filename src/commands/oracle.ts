/**
 * PMM Oracle Commands
 * ===================
 * oracle observe/research/brief/ask/graph/propose
 * The intelligence pillar — insights, knowledge graph, research prompts.
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "oracle:observe": async (db, args) => {
    const since = args[0] || "7d";
    console.log(`Running observation pipeline (since: ${since})...`);
    const proc = Bun.spawnSync(["bun", "scripts/pmm-oracle-observe.ts"], { cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe" });
    console.log(proc.stdout.toString());
    if (proc.stderr.toString()) console.error(proc.stderr.toString());
  },

  "oracle:research": async (db, _args) => {
    console.log("Oracle Research Engine - Web-Connected Discovery");
    console.log("");
    const topErrors = queryAll(db, "SELECT agent_type, COUNT(*) as c FROM agent_workers WHERE status = 'failed' AND started_at > datetime('now', '-14 days') GROUP BY agent_type ORDER BY c DESC LIMIT 3", []) as any[];
    console.log("Context-aware research prompts (based on current platform state):");
    console.log("");
    if (topErrors.length > 0) { console.log("Based on agent errors:"); for (const e of topErrors) { console.log("   Research: " + e.agent_type + " agent failure patterns and fixes"); console.log("   -> GitHub: anthropics/claude-code issues about " + e.agent_type); } console.log(""); }
    console.log("Standard research sources:");
    console.log("   - GitHub Issues: anthropics/claude-code (bug reports, feature requests)");
    console.log("   - Hacker News: Claude Code discussions (community patterns, workarounds)");
    console.log("   - arxiv cs.AI / cs.SE: latest coding agent papers");
    console.log("   - Competitor: Codex CLI, Cursor, OpenHands, SWE-agent");
    console.log(""); console.log("To execute research, spawn the researcher agent with the prompts shown above.");
  },

  "oracle:brief": async (db, _args) => {
    const insights = queryAll(db, "SELECT * FROM oracle_insights WHERE created_at > datetime('now', '-7 days') ORDER BY impact_score DESC NULLS LAST, confidence DESC LIMIT 10", []) as any[];
    console.log("=== PMM Oracle Brief ===");
    console.log("Generated: " + new Date().toISOString().split("T")[0]);
    console.log("");
    console.log("## 1. Platform Health");
    const projectCount = (queryOne(db, "SELECT COUNT(*) as c FROM projects WHERE status = 'active'", []) as any).c;
    const alertCount = (queryOne(db, "SELECT COUNT(*) as c FROM alerts", []) as any).c;
    const sessionCount = (queryOne(db, "SELECT COUNT(*) as c FROM sessions WHERE started_at > datetime('now', '-7 days')", []) as any).c;
    const evalFails = (queryOne(db, "SELECT COUNT(*) as c FROM eval_runs WHERE status IN ('fail','error') AND run_at > datetime('now', '-7 days')", []) as any).c;
    console.log("  Projects: " + projectCount + " | Sessions (7d): " + sessionCount + " | Eval fails: " + evalFails + " | Alerts: " + alertCount);
    console.log("");
    console.log("## 2. Insights & Opportunities");
    console.log("");
    if (insights.length === 0) { console.log("  No insights this week. Run oracle observe to generate."); }
    else {
      const p0 = insights.filter((i: any) => (i.impact_score || 0) >= 0.8);
      const p1 = insights.filter((i: any) => (i.impact_score || 0) >= 0.5 && (i.impact_score || 0) < 0.8);
      const p2 = insights.filter((i: any) => (i.impact_score || 0) < 0.5);
      if (p0.length > 0) { console.log("P0 - HIGH IMPACT:"); for (const i of p0) { console.log("  [!!] " + i.title); console.log("     " + i.description); console.log("     impact: " + (i.impact_score || 0).toFixed(2) + " | confidence: " + (i.confidence || 0).toFixed(2) + " | " + i.status); } console.log(""); }
      if (p1.length > 0) { console.log("P1 - MEDIUM IMPACT:"); for (const i of p1) { console.log("  [!] " + i.title); console.log("     " + i.description); console.log("     impact: " + (i.impact_score || 0).toFixed(2) + " | confidence: " + (i.confidence || 0).toFixed(2) + " | " + i.status); } console.log(""); }
      if (p2.length > 0) { console.log("P2 - LOW IMPACT:"); for (const i of p2) { console.log("  [i] " + i.title); console.log("     " + i.description); } console.log(""); }
    }
    console.log("## 3. Quality Snapshot");
    const latestEvals = queryAll(db, "SELECT ed.eval_id, ed.category, er.status, er.score, er.run_at FROM eval_runs er JOIN eval_defs ed ON er.eval_def_id = ed.id WHERE er.run_at = (SELECT MAX(run_at) FROM eval_runs WHERE eval_def_id = ed.id) ORDER BY CASE er.status WHEN 'fail' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END LIMIT 5", []) as any[];
    if (latestEvals.length > 0) { for (const ev of latestEvals) { const statusIcon = ev.status === "pass" ? "[PASS]" : ev.status === "attention" ? "[WARN]" : "[FAIL]"; console.log("  " + statusIcon + " " + ev.eval_id + " " + ev.status + " (" + (ev.score || "-") + ")"); } }
    else { console.log("  No evaluation data yet. Run evaluator run."); }
    console.log("");
    console.log("## 4. Recommended Actions");
    let actionCount = 0;
    if (evalFails > 0) { console.log("  [P0] Fix " + evalFails + " failing evaluations - run evaluator run for details"); actionCount++; }
    const proposedInsights = insights.filter((i: any) => i.status === "proposed").length;
    if (proposedInsights > 0) { console.log("  [P1] Review " + proposedInsights + " proposed features"); actionCount++; }
    const unhealedDoctor = (queryOne(db, "SELECT COUNT(*) as c FROM doctor_actions WHERE color IN ('green','yellow') AND needs_approval = 0", []) as any).c;
    if (unhealedDoctor > 0) { console.log("  [P1] " + unhealedDoctor + " doctor actions ready - run doctor heal --auto"); actionCount++; }
    if (sessionCount === 0) { console.log("  [P2] No sessions in 7 days - platform may be idle or hooks not firing"); actionCount++; }
    if (actionCount === 0) console.log("  OK - No actions needed");
  },

  "oracle:ask": async (db, args) => {
    requireArgs(1, '"<question>"', "oracle", "ask", args);
    const question = args.join(" ").toLowerCase();
    console.log("Oracle KB Query: " + args.join(" "));
    console.log("");
    if (question.includes("process") || question.includes("methodology")) {
      try {
        const { processScan } = await import("../process/scan");
        const ps = processScan();
        console.log("\n  Process Awareness State:");
        console.log(`    Phase: ${ps.detected_phase} (${(ps.confidence * 100).toFixed(0)}%)`);
        console.log(`    Active Methodologies: ${ps.environment.active_methodologies.join(", ")}`);
        console.log(`    Artifacts Found: ${ps.artifacts.length}`);
        console.log(`    PMM Registered: ${ps.pmm_state.registered ? "yes" : "no"}`);
        console.log(`    Gaps: ${ps.gaps.length}`);
        if (ps.gaps.length > 0) { for (const g of ps.gaps) { console.log(`      - ${g.type}: ${g.description} ${g.auto_fixable ? "[auto-fixable]" : ""}`); } }
      } catch (e: any) { console.log(`    Process awareness not available: ${e.message}`); }
    } else if (question.includes("unused") || question.includes("never used") || question.includes("adoption")) {
      const allAgents = queryAll(db, "SELECT name FROM subagents", []) as any[];
      const usedAgents = queryAll(db, "SELECT DISTINCT agent_type FROM agent_workers WHERE started_at > datetime('now', '-14 days')", []) as any[];
      const usedSet = new Set(usedAgents.map((a: any) => a.agent_type));
      const unused = allAgents.filter((a: any) => !usedSet.has(a.name));
      console.log("Registered agents: " + allAgents.length + " | Used (14d): " + usedSet.size);
      if (unused.length > 0) { console.log("Unused agents (" + unused.length + "):"); for (const a of unused) console.log("  - " + a.name); }
      else { console.log("All registered agents have been used in the last 14 days."); }
    } else if (question.includes("duplicat") || question.includes("overlap")) {
      const toolsDup = queryAll(db, "SELECT tool_name, COUNT(*) as c FROM tooling GROUP BY tool_name HAVING c > 1 ORDER BY c DESC", []) as any[];
      if (toolsDup.length > 0) { console.log("Duplicate tools across projects:"); for (const t of toolsDup) console.log("  - " + t.tool_name + ": " + t.c + " projects"); }
      else { console.log("No duplicate tool registrations found."); }
    } else if (question.includes("depend") || question.includes("coupling")) {
      const deps = queryAll(db, "SELECT p1.name as from_proj, p2.name as to_proj, d.dep_type FROM dependencies d JOIN projects p1 ON d.from_project_id = p1.id JOIN projects p2 ON d.to_project_id = p2.id WHERE d.status = 'active'", []) as any[];
      if (deps.length > 0) { console.log("Active dependencies (" + deps.length + "):"); for (const d of deps) console.log("  " + d.from_proj + " -> " + d.to_proj + " [" + d.dep_type + "]"); }
      else { console.log("No active cross-project dependencies."); }
    } else if (question.includes("error") || question.includes("fail") || question.includes("broken")) {
      const fails = queryAll(db, "SELECT agent_type, result_summary, COUNT(*) as c FROM agent_workers WHERE status = 'failed' AND started_at > datetime('now', '-7 days') GROUP BY agent_type ORDER BY c DESC", []) as any[];
      if (fails.length > 0) { console.log("Recent failures:"); for (const f of fails) { const summary = (f.result_summary || "").slice(0, 80); console.log("  FAIL " + f.agent_type + ": " + f.c + " failures - " + summary); } }
      else { console.log("OK - No agent failures in the last 7 days."); }
    } else {
      console.log("Platform Knowledge Graph Snapshot:");
      console.log("");
      const counts = queryAll(db, "SELECT 'projects' as entity, COUNT(*) as c FROM projects WHERE status='active' UNION ALL SELECT 'agents', COUNT(*) FROM subagents UNION ALL SELECT 'skills', COUNT(*) FROM skills UNION ALL SELECT 'tools', COUNT(*) FROM tooling UNION ALL SELECT 'hooks', COUNT(*) FROM hook_handlers UNION ALL SELECT 'sessions (7d)', COUNT(*) FROM sessions WHERE started_at > datetime('now', '-7 days') UNION ALL SELECT 'workers (7d)', COUNT(*) FROM agent_workers WHERE started_at > datetime('now', '-7 days') UNION ALL SELECT 'insights', COUNT(*) FROM oracle_insights WHERE created_at > datetime('now', '-7 days')", []) as any[];
      for (const c of counts) console.log("  " + String(c.entity).padEnd(20) + " " + c.c);
      console.log(""); console.log("For specific questions, try keywords: unused, duplicate, dependency, error, adoption");
    }
  },

  "oracle:graph": async (db, args) => {
    const projectFilter = args.includes("--project") ? args[args.indexOf("--project") + 1] : null;
    const nodes = queryAll(db, `SELECT 'project' as type, name as id, phase as detail FROM projects WHERE status='active' UNION ALL SELECT 'agent', agent_type, model FROM subagents UNION ALL SELECT 'skill', skill_name, '' FROM skills UNION ALL SELECT 'tool', tool_name, category FROM tooling`, []) as any[];
    const edges = queryAll(db, "SELECT * FROM dependencies WHERE status = 'active'", []) as any[];
    console.log(JSON.stringify({ nodes, edges: edges.map((e: any) => ({ from: e.from_project_id, to: e.to_project_id, type: e.dep_type })), exported_at: new Date().toISOString(), filter: projectFilter }, null, 2));
  },

  "oracle:propose": async (db, args) => {
    requireArgs(1, "<title> [--from <insight-id>] [--impact 0-1] [--feasibility 0-1]", "oracle", "propose", args);
    const title = args[0]!;
    let fromInsight = 0, impact = 0.5, feasibility = 0.5;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--from" && args[i + 1]) fromInsight = parseInt(args[++i]!);
      else if (args[i] === "--impact" && args[i + 1]) impact = parseFloat(args[++i]!);
      else if (args[i] === "--feasibility" && args[i + 1]) feasibility = parseFloat(args[++i]!);
    }
    run(db, `INSERT INTO oracle_insights (category, title, description, confidence, impact_score, feasibility, related_insight_ids, status) VALUES ('proposal', ?, 'Feature proposal: ' || ?, ?, ?, ?, ?, 'proposed')`, [title, title, 0.7, impact, feasibility, fromInsight ? String(fromInsight) : null]);
    const row = queryOne(db, "SELECT id FROM oracle_insights ORDER BY id DESC LIMIT 1") as any;
    console.log(`Proposal #${row.id} created: "${title}" (impact: ${impact}, feasibility: ${feasibility})`);
  },
};
