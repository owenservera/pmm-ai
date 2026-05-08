/**
 * PMM Session Commands
 * ====================
 * session start/register/close/list/get/name/detect-project/reassign/verify-protocol
 * Session lifecycle is the backbone of PMM tracking — every AI harness session
 * starts and ends here.
 */
import type { Database } from "bun:sqlite";
import { getProjectId, getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "session:start": async (db, args) => {
    let project = "";
    let purpose: string | null = null;
    let milestone: string | null = null;
    let task: string | null = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) project = args[++i]!;
      else if (args[i] === "--purpose" && args[i + 1]) purpose = args[++i]!;
      else if (args[i] === "--milestone" && args[i + 1]) milestone = args[++i]!;
      else if (args[i] === "--task" && args[i + 1]) task = args[++i]!;
    }
    if (!project) {
      try {
        const fs = require("node:fs");
        const path = require("node:path");
        const sp = path.join(import.meta.dir, "..", "..", "state", "current-session.json");
        if (fs.existsSync(sp)) {
          const prev = JSON.parse(fs.readFileSync(sp, "utf8"));
          project = prev.project || "";
        }
      } catch { /* no existing session state */ }
    }
    if (!project || !getProjectId(db, project)) {
      if (project) console.error(`⚠️  Project "${project}" not registered. Falling back to TERMINAL.`);
      project = "TERMINAL";
    }
    let name = project;
    if (milestone) name += " / " + milestone;
    if (task) name += " / " + task;
    if (purpose) name += " : " + purpose;
    else name += " : session";
    const pid = getProjectIdOrFail(db, project);
    run(db, "INSERT INTO sessions (project_id, started_at, summary) VALUES (?, ?, ?)", [pid, new Date().toISOString(), purpose || "session started"]);
    const row = queryOne(db, "SELECT id FROM sessions ORDER BY id DESC LIMIT 1") as any;
    const sessionId = row.id;
    const fs = require("node:fs");
    const path = require("node:path");
    const stateDir = path.join(import.meta.dir, "..", "..", "state");
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "current-session.json"), JSON.stringify({ project, milestone, task, purpose, name }, null, 2));
    fs.writeFileSync(path.join(stateDir, "session-protocol.json"), JSON.stringify({
      sessionId, project, startedAt: new Date().toISOString(),
      steps: { continuity: "done", detect: "done", register: "done", health: "pending", drift: "pending", standards: "pending", report: "pending" },
    }, null, 2));
    console.log(JSON.stringify({ sessionId, name, project }));
  },

  "session:register": async (db, args) => {
    requireArgs(1, '<project> [--summary "..."]', "session", "register", args);
    const projectName = args[0]!;
    let summary: string | null = null;
    for (let i = 1; i < args.length; i++) { if (args[i] === "--summary" && args[i + 1]) summary = args[++i]!; }
    const pid = getProjectIdOrFail(db, projectName);
    run(db, "INSERT INTO sessions (project_id, started_at, summary) VALUES (?, ?, ?)", [pid, new Date().toISOString(), summary]);
    const row = queryOne(db, "SELECT id FROM sessions ORDER BY id DESC LIMIT 1") as any;
    console.log(String(row.id));
  },

  "session:close": async (db, args) => {
    requireArgs(0, '[id] [--summary "..."] [--git <commits>]', "session", "close", args);
    let id: number | null = null, summary: string | null = null, gitCommits: string | null = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--summary" && args[i + 1]) summary = args[++i]!;
      else if (args[i] === "--git" && args[i + 1]) gitCommits = args[++i]!;
      else if (!isNaN(parseInt(args[i]!))) id = parseInt(args[i]!);
    }
    if (!id) {
      const latest = queryOne(db, "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1") as any;
      if (latest) id = latest.id;
      else { console.log("No open sessions found. Specify an ID to close."); return; }
    }
    const updates: string[] = ["ended_at = ?"];
    const params: any[] = [new Date().toISOString()];
    if (summary) { updates.push("summary = ?"); params.push(summary); }
    if (gitCommits) { updates.push("git_commits = ?"); params.push(gitCommits); }
    params.push(id);
    run(db, `UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`, params);
    console.log(`Session #${id} closed`);
  },

  "session:list": async (db, args) => {
    let projectFilter = "";
    const params: any[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) { projectFilter = "WHERE p.name = ?"; params.push(args[++i]!); }
    }
    const rows = queryAll(db,
      `SELECT s.id, p.name as project, s.started_at, s.ended_at, s.summary
       FROM sessions s JOIN projects p ON s.project_id = p.id
       ${projectFilter} ORDER BY s.started_at DESC LIMIT 30`, params);
    if (!rows.length) { console.log("No sessions found"); return; }
    table(["#", "Project", "Started", "Ended", "Summary"], rows.map((r: any) => [
      String(r.id), r.project,
      r.started_at?.replace("T", " ").substring(0, 19) || "—",
      r.ended_at?.replace("T", " ").substring(0, 19) || "active",
      r.summary || "—",
    ]));
  },

  "session:get": async (db, args) => {
    requireArgs(1, "<id>", "session", "get", args);
    const id = parseInt(args[0]!);
    const s = queryOne(db,
      `SELECT s.*, p.name as project FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.id = ?`, [id]) as any;
    if (!s) { console.log(`Session #${id} not found`); return; }
    console.log(`Session #${s.id} | ${s.project}`);
    console.log(`  Started:  ${s.started_at?.replace("T", " ").substring(0, 19) || "—"}`);
    console.log(`  Ended:    ${s.ended_at?.replace("T", " ").substring(0, 19) || "active"}`);
    console.log(`  Summary:  ${s.summary || "—"}`);
    console.log(`  Git:      ${s.git_commits || "—"}`);
    console.log(`  Checkpt:  ${s.checkpoint_id || "—"}`);
  },

  "session:name": async (db, args) => {
    requireArgs(1, '<project> [--purpose "..."] [--milestone <name>] [--task <name>]', "session", "name", args);
    let projectName = args[0]!;
    if (!getProjectId(db, projectName)) {
      console.error(`⚠️  Project "${projectName}" not registered in PMM DB.`);
      console.error(`    Falling back to "TERMINAL". Register: bun scripts/pmm.ts project register ${projectName}`);
      projectName = "TERMINAL";
    }
    let purpose: string | null = null, milestone: string | null = null, task: string | null = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--purpose" && args[i + 1]) purpose = args[++i]!;
      else if (args[i] === "--milestone" && args[i + 1]) milestone = args[++i]!;
      else if (args[i] === "--task" && args[i + 1]) task = args[++i]!;
    }
    let name = projectName;
    if (milestone) name += " / " + milestone;
    if (task) name += " / " + task;
    if (purpose) name += " : " + purpose;
    else name += " : session";
    console.log(name);
    const fs = require("node:fs");
    const path = require("node:path");
    const stateDir = path.join(import.meta.dir, "..", "..", "state");
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "current-session.json"), JSON.stringify({ project: projectName, milestone, task, purpose, name }, null, 2));
  },

  "session:detect-project": async (db, args) => {
    requireArgs(1, '"<first-user-message>"', "session", "detect-project", args);
    const message = args.join(" ").toLowerCase();
    const projects = queryAll(db, "SELECT name FROM projects WHERE status = 'active' ORDER BY priority") as any[];
    if (!projects.length) { console.log("TERMINAL"); return; }
    const hits: { name: string; score: number }[] = [];
    for (const p of projects) {
      const pname = (p.name as string).toLowerCase();
      if (message.includes(pname)) hits.push({ name: p.name as string, score: pname.length });
    }
    hits.sort((a, b) => b.score - a.score);
    if (hits.length === 0) console.log("TERMINAL");
    else console.log(hits[0]!.name);
  },

  "session:reassign": async (db, args) => {
    requireArgs(2, "<session-id> <new-project>", "session", "reassign", args);
    const sessionId = parseInt(args[0]!);
    const newProject = args[1]!;
    if (isNaN(sessionId)) { console.log("Invalid session ID"); return; }
    const session = queryOne(db, "SELECT id, project_id FROM sessions WHERE id = ?", [sessionId]) as any;
    if (!session) { console.log(`Session #${sessionId} not found`); return; }
    const newPid = getProjectIdOrFail(db, newProject);
    run(db, "UPDATE sessions SET project_id = ? WHERE id = ?", [newPid, sessionId]);
    console.log(`Session #${sessionId} reassigned → ${newProject}`);
  },

  "session:verify-protocol": async (db, args) => {
    let sessionId: number | null = null;
    for (let i = 0; i < args.length; i++) { if (!isNaN(parseInt(args[i]!))) sessionId = parseInt(args[i]!); }
    const fs = require("node:fs");
    const path = require("node:path");
    const stateFile = path.join(import.meta.dir, "..", "..", "state", "session-protocol.json");
    if (!fs.existsSync(stateFile)) { console.log("PROTOCOL: missing — no session-protocol.json"); process.exit(1); }
    const protocol = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const required = ["continuity", "detect", "register", "health", "drift", "standards", "report"];
    const pending = required.filter((s) => protocol.steps[s] !== "done");
    if (pending.length > 0) { console.log(`PROTOCOL: incomplete — missing: ${pending.join(", ")}`); process.exit(1); }
    if (sessionId && protocol.sessionId !== sessionId) {
      console.log(`PROTOCOL: stale — file is for session #${protocol.sessionId} (current: #${sessionId})`);
      process.exit(1);
    }
    console.log("PROTOCOL: complete");
  },
};
