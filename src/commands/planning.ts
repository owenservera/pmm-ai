/**
 * PMM Planning Commands
 * =====================
 * milestone, feature, roadblock, decision
 * All four share identical CRUD patterns: add, add-batch, list, update, complete/resolve/decide.
 */
import type { Database } from "bun:sqlite";
import { getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs, readBatchInput } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ milestone ═══════════════════════════════════════
  "milestone:add": async (db, args) => {
    requireArgs(2, '<project> <name> [--due <date>] [--criteria "..."] [--status pending]', "milestone", "add", args);
    const projectName = args[0]!;
    const name = args[1]!;
    const pid = getProjectIdOrFail(db, projectName);
    let due: string | null = null, criteria: string | null = null, status = "pending";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--due" && args[i + 1]) due = args[++i]!;
      else if (args[i] === "--criteria" && args[i + 1]) criteria = args[++i]!;
      else if (args[i] === "--status" && args[i + 1]) status = args[++i]!;
    }
    run(db, `INSERT OR REPLACE INTO milestones (project_id, name, due, status, acceptance_criteria) VALUES (?, ?, ?, ?, ?)`,
      [pid, name, due, status, criteria]);
    console.log(`Registered milestone: ${name} → ${projectName} (${status})`);
  },

  "milestone:add-batch": async (db, args) => {
    requireArgs(1, "<project> --json '[...]' | --stdin", "milestone", "add-batch", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    const items = readBatchInput(args.slice(1));
    const stmt = db.prepare(`INSERT OR REPLACE INTO milestones (project_id, name, due, status, acceptance_criteria) VALUES (?, ?, ?, ?, ?)`);
    for (const item of items) { stmt.run(pid, item.name, item.due || null, item.status || "pending", item.criteria || item.acceptance_criteria || null); }
    stmt.finalize();
    console.log(`Batch registered: ${items.length} milestone(s) → ${projectName}`);
  },

  "milestone:list": async (db, args) => {
    requireArgs(1, "<project> [--status <s>] [--overdue] [--format table|json]", "milestone", "list", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let filter = "WHERE project_id = ?";
    const params: any[] = [pid];
    let format = "table";
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--status" && args[i + 1]) { filter += " AND status = ?"; params.push(args[++i]!); }
      else if (args[i] === "--overdue") { filter += " AND due < date('now') AND status != 'completed'"; }
      else if (args[i] === "--format" && args[i + 1]) { format = args[++i]!; }
    }
    const rows = queryAll(db, `SELECT * FROM milestones ${filter} ORDER BY due`, params);
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log("No milestones found"); return; }
    table(["ID", "Name", "Due", "Status", "Criteria"], rows.map((r: any) => [r.id, r.name, r.due || "—", r.status, r.acceptance_criteria || "—"]));
  },

  "milestone:update": async (db, args) => {
    requireArgs(2, '<project> <id> [--name "..."] [--due <date>] [--criteria "..."] [--status <s>]', "milestone", "update", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id FROM milestones WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Milestone #${id} not found in ${projectName}`); return; }
    const sets: string[] = [], vals: any[] = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--name" && args[i + 1]) { sets.push("name = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--due" && args[i + 1]) { sets.push("due = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--criteria" && args[i + 1]) { sets.push("acceptance_criteria = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--status" && args[i + 1]) { sets.push("status = ?"); vals.push(args[++i]!); }
    }
    if (!sets.length) { console.log("No fields to update"); return; }
    vals.push(id);
    run(db, `UPDATE milestones SET ${sets.join(", ")} WHERE id = ?`, vals);
    console.log(`Updated milestone #${id}`);
  },

  "milestone:complete": async (db, args) => {
    requireArgs(2, '<project> <id> [--criteria-met "..."]', "milestone", "complete", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id, name FROM milestones WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Milestone #${id} not found in ${projectName}`); return; }
    let criteriaMet: string | null = null;
    for (let i = 2; i < args.length; i++) { if (args[i] === "--criteria-met" && args[i + 1]) criteriaMet = args[++i]!; }
    run(db, "UPDATE milestones SET status = 'completed', acceptance_criteria = COALESCE(?, acceptance_criteria) WHERE id = ?", [criteriaMet, id]);
    console.log(`Completed milestone #${id}: ${(existing as any).name}`);
  },

  // ═══ feature ═════════════════════════════════════════
  "feature:add": async (db, args) => {
    requireArgs(2, '<project> <name> [--priority medium] [--desc "..."] [--milestone <id>] [--status planned]', "feature", "add", args);
    const projectName = args[0]!;
    const name = args[1]!;
    const pid = getProjectIdOrFail(db, projectName);
    let priority = "medium", desc: string | null = null, milestoneId: number | null = null, status = "planned";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--priority" && args[i + 1]) priority = args[++i]!;
      else if (args[i] === "--desc" && args[i + 1]) desc = args[++i]!;
      else if (args[i] === "--milestone" && args[i + 1]) milestoneId = parseInt(args[++i]!);
      else if (args[i] === "--status" && args[i + 1]) status = args[++i]!;
    }
    run(db, `INSERT OR REPLACE INTO features (project_id, name, status, description, epic_milestone_id, priority) VALUES (?, ?, ?, ?, ?, ?)`,
      [pid, name, status, desc, milestoneId, priority]);
    console.log(`Registered feature: ${name} → ${projectName} (${priority})`);
  },

  "feature:add-batch": async (db, args) => {
    requireArgs(1, "<project> --json '[...]' | --stdin", "feature", "add-batch", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    const items = readBatchInput(args.slice(1));
    const stmt = db.prepare(`INSERT OR REPLACE INTO features (project_id, name, status, description, epic_milestone_id, priority) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const item of items) { stmt.run(pid, item.name, item.status || "planned", item.description || item.desc || null, item.milestone || item.epic_milestone_id || null, item.priority || "medium"); }
    stmt.finalize();
    console.log(`Batch registered: ${items.length} feature(s) → ${projectName}`);
  },

  "feature:list": async (db, args) => {
    requireArgs(1, "<project> [--status <s>] [--priority <p>] [--milestone <id>] [--format table|json]", "feature", "list", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let filter = "WHERE project_id = ?";
    const params: any[] = [pid];
    let format = "table";
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--status" && args[i + 1]) { filter += " AND status = ?"; params.push(args[++i]!); }
      else if (args[i] === "--priority" && args[i + 1]) { filter += " AND priority = ?"; params.push(args[++i]!); }
      else if (args[i] === "--milestone" && args[i + 1]) { filter += " AND epic_milestone_id = ?"; params.push(parseInt(args[++i]!)); }
      else if (args[i] === "--format" && args[i + 1]) { format = args[++i]!; }
    }
    const rows = queryAll(db, `SELECT * FROM features ${filter} ORDER BY priority, name`, params);
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log("No features found"); return; }
    table(["ID", "Name", "Status", "Priority", "Milestone", "Description"], rows.map((r: any) => [r.id, r.name, r.status, r.priority, r.epic_milestone_id || "—", r.description || "—"]));
  },

  "feature:update": async (db, args) => {
    requireArgs(2, '<project> <id> [--name "..."] [--priority <p>] [--desc "..."] [--milestone <id>] [--status <s>]', "feature", "update", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id FROM features WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Feature #${id} not found in ${projectName}`); return; }
    const sets: string[] = [], vals: any[] = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--name" && args[i + 1]) { sets.push("name = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--priority" && args[i + 1]) { sets.push("priority = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--desc" && args[i + 1]) { sets.push("description = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--milestone" && args[i + 1]) { sets.push("epic_milestone_id = ?"); vals.push(parseInt(args[++i]!)); }
      else if (args[i] === "--status" && args[i + 1]) { sets.push("status = ?"); vals.push(args[++i]!); }
    }
    if (!sets.length) { console.log("No fields to update"); return; }
    vals.push(id);
    run(db, `UPDATE features SET ${sets.join(", ")} WHERE id = ?`, vals);
    console.log(`Updated feature #${id}`);
  },

  "feature:complete": async (db, args) => {
    requireArgs(2, "<project> <id>", "feature", "complete", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id, name FROM features WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Feature #${id} not found in ${projectName}`); return; }
    run(db, "UPDATE features SET status = 'done' WHERE id = ?", [id]);
    console.log(`Completed feature #${id}: ${(existing as any).name}`);
  },

  // ═══ roadblock ═══════════════════════════════════════
  "roadblock:add": async (db, args) => {
    requireArgs(2, "<project> <description> [--severity medium] [--milestone <id>]", "roadblock", "add", args);
    const projectName = args[0]!;
    const description = args[1]!;
    const pid = getProjectIdOrFail(db, projectName);
    let severity = "medium", milestoneId: number | null = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--severity" && args[i + 1]) severity = args[++i]!;
      else if (args[i] === "--milestone" && args[i + 1]) milestoneId = parseInt(args[++i]!);
    }
    run(db, `INSERT INTO roadblocks (project_id, description, severity, milestone_id) VALUES (?, ?, ?, ?)`, [pid, description, severity, milestoneId]);
    console.log(`Registered roadblock → ${projectName} (${severity})`);
  },

  "roadblock:add-batch": async (db, args) => {
    requireArgs(1, "<project> --json '[...]' | --stdin", "roadblock", "add-batch", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    const items = readBatchInput(args.slice(1));
    const stmt = db.prepare(`INSERT INTO roadblocks (project_id, description, severity, milestone_id) VALUES (?, ?, ?, ?)`);
    for (const item of items) { stmt.run(pid, item.description || item.desc, item.severity || "medium", item.milestone || item.milestone_id || null); }
    stmt.finalize();
    console.log(`Batch registered: ${items.length} roadblock(s) → ${projectName}`);
  },

  "roadblock:list": async (db, args) => {
    requireArgs(1, "<project> [--severity <s>] [--active] [--resolved] [--format table|json]", "roadblock", "list", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let filter = "WHERE project_id = ?";
    const params: any[] = [pid];
    let format = "table";
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--severity" && args[i + 1]) { filter += " AND severity = ?"; params.push(args[++i]!); }
      else if (args[i] === "--active") { filter += " AND resolved_at IS NULL"; }
      else if (args[i] === "--resolved") { filter += " AND resolved_at IS NOT NULL"; }
      else if (args[i] === "--format" && args[i + 1]) { format = args[++i]!; }
    }
    const rows = queryAll(db, `SELECT * FROM roadblocks ${filter} ORDER BY severity, created_at DESC`, params);
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log("No roadblocks found"); return; }
    table(["ID", "Severity", "Description", "Milestone", "Resolved"], rows.map((r: any) => [r.id, r.severity, r.description, r.milestone_id || "—", r.resolved_at || "active"]));
  },

  "roadblock:resolve": async (db, args) => {
    requireArgs(2, '<project> <id> [--resolution "..."]', "roadblock", "resolve", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id FROM roadblocks WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Roadblock #${id} not found in ${projectName}`); return; }
    let resolution: string | null = null;
    for (let i = 2; i < args.length; i++) { if (args[i] === "--resolution" && args[i + 1]) resolution = args[++i]!; }
    run(db, "UPDATE roadblocks SET resolved_at = datetime('now'), resolution = ? WHERE id = ?", [resolution, id]);
    console.log(`Resolved roadblock #${id}`);
  },

  // ═══ decision ════════════════════════════════════════
  "decision:add": async (db, args) => {
    requireArgs(2, '<project> <question> [--decision "..."] [--rationale "..."]', "decision", "add", args);
    const projectName = args[0]!;
    const question = args[1]!;
    const pid = getProjectIdOrFail(db, projectName);
    let decision: string | null = null, rationale: string | null = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--decision" && args[i + 1]) decision = args[++i]!;
      else if (args[i] === "--rationale" && args[i + 1]) rationale = args[++i]!;
    }
    run(db, `INSERT OR REPLACE INTO decisions (project_id, question, decision, rationale, status) VALUES (?, ?, ?, ?, ?)`,
      [pid, question, decision, rationale, decision ? "decided" : "open"]);
    console.log(`Registered decision → ${projectName} (${decision ? "decided" : "open"})`);
  },

  "decision:add-batch": async (db, args) => {
    requireArgs(1, "<project> --json '[...]' | --stdin", "decision", "add-batch", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    const items = readBatchInput(args.slice(1));
    const stmt = db.prepare(`INSERT OR REPLACE INTO decisions (project_id, question, decision, rationale, status) VALUES (?, ?, ?, ?, ?)`);
    for (const item of items) { stmt.run(pid, item.question, item.decision || null, item.rationale || item.why || null, item.decision ? "decided" : "open"); }
    stmt.finalize();
    console.log(`Batch registered: ${items.length} decision(s) → ${projectName}`);
  },

  "decision:list": async (db, args) => {
    requireArgs(1, "<project> [--status <s>] [--format table|json]", "decision", "list", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let filter = "WHERE project_id = ?";
    const params: any[] = [pid];
    let format = "table";
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--status" && args[i + 1]) { filter += " AND status = ?"; params.push(args[++i]!); }
      else if (args[i] === "--format" && args[i + 1]) { format = args[++i]!; }
    }
    const rows = queryAll(db, `SELECT * FROM decisions ${filter} ORDER BY created_at DESC`, params);
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log("No decisions found"); return; }
    table(["ID", "Status", "Question", "Decision", "Rationale"], rows.map((r: any) => [r.id, r.status, r.question, r.decision || "—", r.rationale || "—"]));
  },

  "decision:decide": async (db, args) => {
    requireArgs(3, '<project> <id> --decision "..." [--rationale "..."]', "decision", "decide", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id, question FROM decisions WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Decision #${id} not found in ${projectName}`); return; }
    let decisionText = "", rationale: string | null = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--decision" && args[i + 1]) decisionText = args[++i]!;
      else if (args[i] === "--rationale" && args[i + 1]) rationale = args[++i]!;
    }
    if (!decisionText) { console.log("--decision is required"); return; }
    run(db, "UPDATE decisions SET decision = ?, rationale = COALESCE(?, rationale), status = 'decided' WHERE id = ?", [decisionText, rationale, id]);
    console.log(`Decided #${id}: ${(existing as any).question} → ${decisionText}`);
  },

  // ═══ decision:review ════════════════════════════════════
  "decision:review": async (db, args) => {
    requireArgs(1, "<project> [--all]", "decision", "review", args);
    const projectName = args[0]!;
    const showAll = args.includes("--all");
    const { badge, divider } = await import("./shared");
    const pid = getProjectIdOrFail(db, projectName);

    const openDecisions = queryAll(db, "SELECT * FROM decisions WHERE project_id = ? AND status = 'open' ORDER BY created_at", [pid]) as any[];
    const decidedCount = (queryOne(db, "SELECT COUNT(*) as c FROM decisions WHERE project_id = ? AND status = 'decided'", [pid]) as any).c;

    console.log(`\n${badge(`═══ Decision Review: ${projectName} ═══`, "blue")}\n`);

    if (!openDecisions.length && !showAll) {
      console.log(`  ${badge("✓ No open decisions", "green")} — ${decidedCount} decided total`);
      console.log(`\n  To see all decisions: bun scripts/cli.ts decision review ${projectName} --all`);
      console.log("");
      return;
    }

    if (openDecisions.length) {
      // Group: decisions linked to roadblocks or milestones are "blocking"
      const blocking: any[] = [];
      const normal: any[] = [];
      for (const d of openDecisions) {
        // Heuristic: if the question mentions "block", or there's a roadblock referencing it, mark as blocking
        const qLower = (d.question || "").toLowerCase();
        if (qLower.includes("block") || qLower.includes("critical") || qLower.includes("migration") || qLower.includes("architecture")) {
          blocking.push(d);
        } else {
          normal.push(d);
        }
      }

      if (blocking.length) {
        console.log(badge("  🔴 HIGH IMPACT (likely blocking)", "red"));
        divider("", 54);
        for (const d of blocking) {
          console.log(`  #${String(d.id).padEnd(4)} ${d.question}`);
          if (d.rationale) console.log(`        ${badge("context:", "dim")} ${d.rationale}`);
          console.log(`        ${badge("DECIDE:", "dim")} bun scripts/cli.ts decision decide ${projectName} ${d.id} --decision "..." --rationale "..."`);
          console.log("");
        }
      }

      if (normal.length) {
        console.log(badge("  🟡 OPEN — needs decision", "yellow"));
        divider("", 54);
        for (const d of normal) {
          console.log(`  #${String(d.id).padEnd(4)} ${d.question}`);
          if (d.rationale) console.log(`        ${badge("context:", "dim")} ${d.rationale}`);
          console.log(`        ${badge("DECIDE:", "dim")} bun scripts/cli.ts decision decide ${projectName} ${d.id} --decision "..." --rationale "..."`);
          console.log("");
        }
      }
    }

    if (showAll && decidedCount > 0) {
      const decided = queryAll(db, "SELECT * FROM decisions WHERE project_id = ? AND status = 'decided' ORDER BY created_at DESC", [pid]) as any[];
      console.log(badge("  🟢 DECIDED (ADR log)", "green"));
      divider("", 54);
      for (const d of decided) {
        console.log(`  #${String(d.id).padEnd(4)} ${d.question}`);
        console.log(`        → ${badge(d.decision, "green")}${d.rationale ? `  (${d.rationale})` : ""}`);
      }
      console.log("");
    }

    console.log(`  ${badge(`Summary: ${openDecisions.length} open · ${decidedCount} decided`, openDecisions.length ? "yellow" : "green")}`);
    console.log("");
  },
};
