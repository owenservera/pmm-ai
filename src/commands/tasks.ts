/**
 * PMM Task Commands
 * =================
 * task add/list/update/complete/log with enrichment fields
 * (append-note, methods, evidence, session linking).
 */
import type { Database } from "bun:sqlite";
import { getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs, readBatchInput } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "task:add": async (db, args) => {
    requireArgs(2, '<project> <name> [--milestone <id>] [--notes "..."] [--status pending]', "task", "add", args);
    const projectName = args[0]!;
    const name = args[1]!;
    const pid = getProjectIdOrFail(db, projectName);
    let milestoneId: number | null = null, notes: string | null = null, status = "pending";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--milestone" && args[i + 1]) milestoneId = parseInt(args[++i]!);
      else if (args[i] === "--notes" && args[i + 1]) notes = args[++i]!;
      else if (args[i] === "--status" && args[i + 1]) status = args[++i]!;
    }
    run(db, `INSERT INTO atomic_tasks (project_id, milestone_id, name, status, notes, session_id, methods, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [pid, milestoneId, name, status, notes, null, null, null]);
    console.log(`Registered task: ${name} → ${projectName} (${status})`);
  },

  "task:add-batch": async (db, args) => {
    requireArgs(1, "<project> --json '[...]' | --stdin", "task", "add-batch", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    const items = readBatchInput(args.slice(1));
    const stmt = db.prepare(`INSERT INTO atomic_tasks (project_id, milestone_id, name, status, notes, session_id, methods, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of items) { stmt.run(pid, item.milestone || item.milestone_id || null, item.name, item.status || "pending", item.notes || null, item.session_id || null, item.methods || null, item.evidence || null); }
    stmt.finalize();
    console.log(`Batch registered: ${items.length} task(s) → ${projectName}`);
  },

  "task:list": async (db, args) => {
    requireArgs(1, "<project> [--status <s>] [--milestone <id>] [--format table|json]", "task", "list", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let filter = "WHERE project_id = ?";
    const params: any[] = [pid];
    let format = "table";
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--status" && args[i + 1]) { filter += " AND status = ?"; params.push(args[++i]!); }
      else if (args[i] === "--milestone" && args[i + 1]) { filter += " AND milestone_id = ?"; params.push(parseInt(args[++i]!)); }
      else if (args[i] === "--format" && args[i + 1]) { format = args[++i]!; }
    }
    const rows = queryAll(db, `SELECT * FROM atomic_tasks ${filter} ORDER BY milestone_id, status, name`, params);
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log("No tasks found"); return; }
    table(["ID", "Name", "Status", "Milestone", "Notes"], rows.map((r: any) => [r.id, r.name, r.status, r.milestone_id || "—", r.notes || "—"]));
  },

  "task:update": async (db, args) => {
    requireArgs(2, '<project> <id> [--name "..."] [--status <s>] [--milestone <id>] [--notes "..."] [--append-note "..."] [--method "..."] [--session <id>]', "task", "update", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id, notes FROM atomic_tasks WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Task #${id} not found in ${projectName}`); return; }
    const sets: string[] = [], vals: any[] = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--name" && args[i + 1]) { sets.push("name = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--status" && args[i + 1]) { sets.push("status = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--milestone" && args[i + 1]) { sets.push("milestone_id = ?"); vals.push(parseInt(args[++i]!)); }
      else if (args[i] === "--notes" && args[i + 1]) { sets.push("notes = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--append-note" && args[i + 1]) {
        const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
        const line = `\n[${timestamp}] ${args[++i]!}`;
        const oldNotes: string = (existing as any).notes || "";
        sets.push("notes = ?"); vals.push(oldNotes + line);
      } else if (args[i] === "--method" && args[i + 1]) { sets.push("methods = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--session" && args[i + 1]) { sets.push("session_id = ?"); vals.push(parseInt(args[++i]!)); }
    }
    if (!sets.length) { console.log("No fields to update"); return; }
    vals.push(id);
    run(db, `UPDATE atomic_tasks SET ${sets.join(", ")} WHERE id = ?`, vals);
    console.log(`Updated task #${id}`);
  },

  "task:complete": async (db, args) => {
    requireArgs(2, '<project> <id> [--notes "..."] [--append-note "..."] [--method "..."] [--evidence "..."] [--session <id>]', "task", "complete", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const existing = queryOne(db, "SELECT id, name, notes FROM atomic_tasks WHERE id = ? AND project_id = ?", [id, pid]);
    if (!existing) { console.log(`Task #${id} not found in ${projectName}`); return; }
    let notes: string | null = null, appendNotes: string | null = null;
    let method: string | null = null, evidence: string | null = null, sessionId: number | null = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--notes" && args[i + 1]) notes = args[++i]!;
      else if (args[i] === "--append-note" && args[i + 1]) {
        const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
        appendNotes = (appendNotes || "") + `\n[${ts}] ${args[++i]!}`;
      } else if (args[i] === "--method" && args[i + 1]) method = args[++i]!;
      else if (args[i] === "--evidence" && args[i + 1]) evidence = args[++i]!;
      else if (args[i] === "--session" && args[i + 1]) sessionId = parseInt(args[++i]!);
    }
    let finalNotes = notes;
    if (appendNotes) { const oldNotes: string = notes || (existing as any).notes || ""; finalNotes = oldNotes + appendNotes; }
    const updSets: string[] = ["status = 'done'", "completed_at = datetime('now')", "closed_at = datetime('now')"];
    const updVals: any[] = [];
    updSets.push("notes = COALESCE(?, notes)"); updVals.push(finalNotes);
    if (method) { updSets.push("methods = ?"); updVals.push(method); }
    if (evidence) { updSets.push("evidence = ?"); updVals.push(evidence); }
    if (sessionId) { updSets.push("session_id = ?"); updVals.push(sessionId); }
    updVals.push(id);
    run(db, `UPDATE atomic_tasks SET ${updSets.join(", ")} WHERE id = ?`, updVals);
    console.log(`Completed task #${id}: ${(existing as any).name}`);
  },

  "task:log": async (db, args) => {
    requireArgs(2, "<project> <id> [--format table|json]", "task", "log", args);
    const projectName = args[0]!;
    const id = parseInt(args[1]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    const task = queryOne(db,
      `SELECT t.*, m.name as milestone_name, s.summary as session_summary
       FROM atomic_tasks t
       LEFT JOIN milestones m ON t.milestone_id = m.id
       LEFT JOIN sessions s ON t.session_id = s.id
       WHERE t.id = ? AND t.project_id = ?`, [id, pid]) as any;
    if (!task) { console.log(`Task #${id} not found in ${projectName}`); return; }
    let format = "table";
    for (let i = 2; i < args.length; i++) { if (args[i] === "--format" && args[i + 1]) format = args[++i]!; }
    if (format === "json") { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(`\n  === Task #${task.id} ===`);
    console.log(`  Name:       ${task.name}`);
    console.log(`  Status:     ${task.status}`);
    console.log(`  Milestone:  ${task.milestone_name || "—"}`);
    console.log(`  Session:    ${task.session_summary || (task.session_id ? `#${task.session_id}` : "—")}`);
    console.log(`  Methods:    ${task.methods || "—"}`);
    console.log(`  Evidence:   ${task.evidence || "—"}`);
    console.log(`  Created:    ${task.created_at || "—"}`);
    console.log(`  Completed:  ${task.completed_at || "—"}`);
    console.log(`  Closed:     ${task.closed_at || "—"}`);
    console.log(`  Notes:${task.notes ? "\n" + task.notes : " —"}`);
    console.log("");
  },
};
