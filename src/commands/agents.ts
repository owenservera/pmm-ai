/**
 * PMM Agent + Worker Commands
 * ============================
 * agent list/force-register/unforce/policy/spawn-health-scorer/run-drift-scan/run-standards
 * worker dispatch/update/list/trace/schedule
 */
import type { Database } from "bun:sqlite";
import { getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ agent ═══════════════════════════════════════════
  "agent:list": async (db, _args) => {
    const rows = queryAll(db, `SELECT s.name, s.domain, s.tier, s.model, s.trackable, s.force_register, p.name as project FROM subagents s JOIN projects p ON s.project_id = p.id ORDER BY s.domain, s.tier`);
    table(["Agent", "Domain", "Tier", "Model", "Track", "Force", "Project"], rows.map((r: any) => [r.name, r.domain, r.tier, r.model, r.trackable ? "✓" : "", r.force_register ? "✓" : "", r.project]));
  },

  "agent:force-register": async (db, args) => {
    requireArgs(1, "<agent-name>", "agent", "force-register", args);
    const name = args[0]!;
    run(db, "UPDATE subagents SET force_register = 1, trackable = 1 WHERE name = ?", [name]);
    console.log(`Force-registered agent: ${name}`);
  },

  "agent:unforce": async (db, args) => {
    requireArgs(1, "<agent-name>", "agent", "unforce", args);
    const name = args[0]!;
    run(db, "UPDATE subagents SET force_register = 0 WHERE name = ?", [name]);
    console.log(`Removed force-registration: ${name}`);
  },

  "agent:policy": async (db, _args) => {
    const config = queryOne(db, "SELECT value FROM automation_configs WHERE key = 'agent_registration' AND project_id = (SELECT id FROM projects WHERE name = 'TERMINAL')") as any;
    const mode = config?.value || "tracked";
    console.log(`Global: ${mode}`);
    const forced = queryAll(db, "SELECT name FROM subagents WHERE force_register = 1 ORDER BY name");
    console.log(`Force-registered: ${forced.map((f: any) => f.name).join(", ") || "none"}`);
    const trackable = queryAll(db, "SELECT name FROM subagents WHERE trackable = 1 AND force_register = 0 ORDER BY name");
    console.log(`Trackable: ${trackable.map((f: any) => f.name).join(", ") || "none"}`);
    const skipped = queryAll(db, "SELECT name FROM subagents WHERE trackable = 0 AND force_register = 0 ORDER BY name");
    console.log(`Skipped: ${skipped.map((f: any) => f.name).join(", ") || "none"}`);
  },

  "agent:spawn-health-scorer": async (db, args) => {
    let projectName = "TERMINAL";
    for (let i = 0; i < args.length; i++) { if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!; }
    const pid = getProjectIdOrFail(db, projectName);
    const config = queryOne(db, "SELECT value FROM automation_configs WHERE key = 'agent_registration' AND project_id = (SELECT id FROM projects WHERE name = 'TERMINAL')") as any;
    const mode = config?.value || "tracked";
    const subagent = queryOne(db, "SELECT id, force_register FROM subagents WHERE name = 'pmm-health-scorer' AND project_id = ?", [pid]) as any;
    if (mode === "off" && !subagent?.force_register) { console.log("agent_registration=off. Use --force to override."); return; }
    run(db, `INSERT INTO agent_workers (project_id, subagent_id, name, agent_type, model, status, task_description) VALUES (?, ?, ?, ?, ?, 'dispatched', ?)`,
      [pid, subagent?.id || null, `pmm-health-scorer #${Date.now().toString(36)}`, "pmm-health-scorer", "sonnet", "Score health for all active projects"]);
    const worker = queryOne(db, "SELECT id FROM agent_workers ORDER BY id DESC LIMIT 1") as any;
    console.log(`Worker #${worker.id} dispatched (pmm-health-scorer | sonnet | ${projectName})`);
    console.log("");
    console.log("Copy-paste to spawn:");
    console.log(`  Task(subagent_type="pmm-health-scorer", model="sonnet",`);
    console.log(`       prompt="Score health for all active projects.`);
    console.log(`       YOUR PMM WORKER ID IS #${worker.id}.`);
    console.log(`       Run 'bun scripts/pmm.ts worker update ${worker.id} --status running --started'.`);
    console.log(`       On completion run 'bun scripts/pmm.ts worker update ${worker.id} --status completed --result \\"...\\"'.`);
  },

  "agent:run-drift-scan": async (db, args) => {
    let projectName = "TERMINAL";
    for (let i = 0; i < args.length; i++) { if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!; }
    const fs = require("node:fs");
    const path = require("node:path");
    const root = process.cwd();
    const agentsDir = path.join(root, ".claude", "agents");
    const skillsDir = path.join(root, ".claude", "skills");
    const gaps: string[] = [];
    if (fs.existsSync(agentsDir)) {
      const diskAgents = fs.readdirSync(agentsDir).filter((f: string) => f.endsWith(".md")).map((f: string) => f.replace(".md", ""));
      const dbAgents = queryAll(db, "SELECT name FROM subagents").map((r: any) => r.name);
      for (const a of diskAgents) { if (!dbAgents.includes(a)) gaps.push(`agent:${a} (on disk, not in DB)`); }
    }
    if (fs.existsSync(skillsDir)) {
      const diskSkills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name);
      const dbSkills = queryAll(db, "SELECT name FROM skills WHERE status = 'active'").map((r: any) => r.name);
      for (const s of diskSkills) { if (!dbSkills.includes(s)) gaps.push(`skill:${s} (on disk, not in DB)`); }
    }
    if (gaps.length === 0) { console.log("Drift: clean — 0 gaps"); }
    else {
      console.log(`Drift: ${gaps.length} gap(s) found:`);
      for (const g of gaps) console.log(`  ✗ ${g}`);
      const autoFix = queryOne(db, "SELECT value FROM automation_configs WHERE key = 'pmm.drift.auto_fix' AND project_id = (SELECT id FROM projects WHERE name = 'TERMINAL')") as any;
      if (autoFix?.value === "true") console.log("  → auto_fix=true. Run 'pmm fix' or spawn pmm-sync to repair.");
    }
  },

  "agent:run-standards": async (db, args) => {
    let projectName = "TERMINAL";
    for (let i = 0; i < args.length; i++) { if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!; }
    const { execSync } = require("node:child_process");
    try { execSync(`bun scripts/pmm.ts standards check ${JSON.stringify(projectName)}`, { stdio: "inherit", cwd: process.cwd() }); } catch { /* output handled by subprocess */ }
  },

  // ═══ worker ══════════════════════════════════════════
  "worker:dispatch": async (db, args) => {
    requireArgs(3, "<agent-type> <model> <task> [--project <name>] [--milestone <id>]", "worker", "dispatch", args);
    const agentType = args[0]!;
    const model = args[1]!;
    const task = args[2]!;
    let projectName = "TERMINAL", milestoneId: number | null = null;
    for (let i = 3; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!;
      else if (args[i] === "--milestone" && args[i + 1]) milestoneId = parseInt(args[++i]!);
    }
    const pid = getProjectIdOrFail(db, projectName);
    const subagent = queryOne(db, "SELECT id FROM subagents WHERE name = ? AND project_id = ?", [agentType, pid]) as any;
    const name = `${agentType} #${Date.now().toString(36)}`;
    run(db, `INSERT INTO agent_workers (project_id, subagent_id, name, agent_type, model, status, task_description, milestone_id) VALUES (?, ?, ?, ?, ?, 'dispatched', ?, ?)`,
      [pid, subagent?.id || null, name, agentType, model, task, milestoneId]);
    const worker = queryOne(db, "SELECT id FROM agent_workers WHERE name = ?", [name]) as any;
    console.log(String(worker.id));
  },

  "worker:update": async (db, args) => {
    requireArgs(2, '<id> --status <status> [--started] [--result "..."]', "worker", "update", args);
    const workerId = parseInt(args[0]!);
    let status = "", result: string | null = null, setStarted = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--status" && args[i + 1]) status = args[++i]!;
      else if (args[i] === "--result" && args[i + 1]) result = args[++i]!;
      else if (args[i] === "--started") setStarted = true;
    }
    if (status === "running" || setStarted) {
      run(db, "UPDATE agent_workers SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?", [workerId]);
    } else if (status === "completed" || status === "failed" || status === "cancelled") {
      run(db, "UPDATE agent_workers SET status = ?, completed_at = datetime('now'), result_summary = ? WHERE id = ?", [status, result, workerId]);
    } else if (status) {
      run(db, "UPDATE agent_workers SET status = ? WHERE id = ?", [status, workerId]);
    }
    console.log(`Worker #${workerId} → ${status}`);
  },

  "worker:list": async (db, args) => {
    let filter = "";
    const params: any[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--status" && args[i + 1]) { filter = "WHERE w.status = ?"; params.push(args[++i]!); }
      else if (args[i] === "--project" && args[i + 1]) { filter = filter ? `${filter} AND p.name = ?` : "WHERE p.name = ?"; params.push(args[++i]!); }
    }
    const rows = queryAll(db, `SELECT w.id, w.name, w.agent_type, w.model, p.name as project, w.task_description, w.status, w.started_at FROM agent_workers w JOIN projects p ON w.project_id = p.id ${filter} ORDER BY w.created_at DESC LIMIT 20`, params);
    if (!rows.length) { console.log("No workers found"); return; }
    table(["#", "Agent", "Model", "Project", "Task", "Status", "Started"], rows.map((r: any) => [String(r.id), r.agent_type, r.model, r.project, r.task_description || "—", r.status, r.started_at || "—"]));
  },

  "worker:trace": async (db, args) => {
    requireArgs(1, "<id>", "worker", "trace", args);
    let id = parseInt(args[0]!);
    let indent = 0;
    while (id) {
      const w = queryOne(db, `SELECT w.*, p.name as project FROM agent_workers w JOIN projects p ON w.project_id = p.id WHERE w.id = ?`, [id]) as any;
      if (!w) { console.log(`${"  ".repeat(indent)}Worker #${id} not found`); break; }
      const icon = w.status === "running" ? "🟢" : w.status === "completed" ? "✓" : w.status === "failed" ? "✗" : "○";
      console.log(`${"  ".repeat(indent)}${icon} #${w.id} ← ${w.agent_type} (${w.model}) · ${w.project} · "${w.task_description || "?"}" [${w.status}]`);
      id = w.parent_worker_id;
      indent++;
    }
  },

  "worker:schedule": async (db, args) => {
    requireArgs(1, "<add|list|trigger|delete> [args]", "worker", "schedule", args);
    const schedAction = args[0]!;
    if (schedAction === "add") {
      requireArgs(6, "add <project> <name> <agent-type> <model> <interval-sec> [--desc \"...\"] [--priority high]", "worker", "schedule", args);
      const projName = args[1]!; const wName = args[2]!; const agentType = args[3]!; const model = args[4]!; const intervalSec = parseInt(args[5]!);
      if (isNaN(intervalSec) || intervalSec < 30) { console.log("Interval must be >= 30 seconds"); return; }
      const pid = getProjectIdOrFail(db, projName);
      let desc: string | null = null, priority = "normal";
      for (let i = 6; i < args.length; i++) { if (args[i] === "--desc" && args[i + 1]) desc = args[++i]!; else if (args[i] === "--priority" && args[i + 1]) priority = args[++i]!; }
      run(db, `INSERT INTO background_workers (project_id, name, agent_type, model, description, schedule_interval, priority, next_run_at) VALUES (?,?,?,?,?,?,?,datetime('now', '+' || ? || ' seconds'))`,
        [pid, wName, agentType, model, desc, intervalSec, priority, intervalSec]);
      console.log(`Background worker scheduled: ${wName} [${agentType}/${model}] every ${intervalSec}s (${priority})`);
    } else if (schedAction === "list") {
      requireArgs(2, "list <project> [--format table|json]", "worker", "schedule", args);
      const projName = args[1]!; const pid = getProjectIdOrFail(db, projName);
      let format = "table";
      for (let i = 2; i < args.length; i++) if (args[i] === "--format" && args[i + 1]) format = args[++i]!;
      const workers = queryAll(db, "SELECT * FROM background_workers WHERE project_id = ? AND is_enabled = 1 ORDER BY priority, schedule_interval", [pid]);
      if (format === "json") { console.log(JSON.stringify(workers, null, 2)); return; }
      if (!workers.length) { console.log("No background workers scheduled."); return; }
      table(["ID", "Name", "Agent", "Model", "Interval", "Priority", "Next Run", "Count"], workers.map((w: any) => [String(w.id), w.name, w.agent_type, w.model, `${w.schedule_interval}s`, w.priority, w.next_run_at || "?", String(w.run_count)]));
    } else if (schedAction === "trigger") {
      requireArgs(3, "trigger <project> <id>", "worker", "schedule", args);
      const projName = args[1]!; const workerId = parseInt(args[2]!);
      getProjectIdOrFail(db, projName);
      const bw = queryOne(db, "SELECT * FROM background_workers WHERE id = ?", [workerId]) as any;
      if (!bw) { console.log(`Background worker #${workerId} not found`); return; }
      const name = `${bw.name} #${Date.now().toString(36)}`;
      run(db, `INSERT INTO agent_workers (project_id, name, agent_type, model, status, task_description) VALUES (?,?,?,?, 'dispatched', ?)`, [bw.project_id, name, bw.agent_type, bw.model, `[background] ${bw.description || bw.name}`]);
      const worker = queryOne(db, "SELECT id FROM agent_workers WHERE name = ?", [name]) as any;
      run(db, "UPDATE background_workers SET last_run_at = datetime('now'), next_run_at = datetime('now', '+' || schedule_interval || ' seconds'), run_count = run_count + 1 WHERE id = ?", [workerId]);
      console.log(`Triggered: ${bw.name} → worker #${worker.id}`);
    } else if (schedAction === "delete") {
      requireArgs(3, "delete <project> <id>", "worker", "schedule", args);
      const projName = args[1]!; const workerId = parseInt(args[2]!);
      getProjectIdOrFail(db, projName);
      run(db, "DELETE FROM background_workers WHERE id = ?", [workerId]);
      console.log(`Background worker #${workerId} removed`);
    }
  },
};
