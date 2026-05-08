/**
 * PMM Project Commands
 * ====================
 * project register/list/get/update/delete/onboard/discover/discover-all
 * tool add/list
 */
import type { Database } from "bun:sqlite";
import { getProjectId, getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs, readBatchInput } from "./shared";
import { discoverProject } from "./discovery";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "project:register": async (db, args) => {
    requireArgs(1, "<name> [--phase build] [--priority high] [--health healthy] [--repo <path>] [--tech <comma,sep>]", "project", "register", args);
    const name = args[0]!;
    const existing = queryOne(db, "SELECT id FROM projects WHERE name = ?", [name]);
    if (existing) {
      console.log(`Project "${name}" already registered`);
      return;
    }
    let phase = "define", priority = "medium", health = "healthy", repo: string | null = null, tech: string[] = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--phase" && args[i + 1]) phase = args[++i]!;
      else if (args[i] === "--priority" && args[i + 1]) priority = args[++i]!;
      else if (args[i] === "--health" && args[i + 1]) health = args[++i]!;
      else if (args[i] === "--repo" && args[i + 1]) repo = args[++i]!;
      else if (args[i] === "--tech" && args[i + 1]) tech = args[++i]!.split(",");
    }
    run(db, `INSERT INTO projects (name, status, phase, priority, repo_path, tech_stack, health) VALUES (?, 'active', ?, ?, ?, ?, ?)`,
      [name, phase, priority, repo, JSON.stringify(tech), health]);
    console.log(`Registered project: ${name} (${phase}/${priority})`);
  },

  "project:list": async (db, args) => {
    let unlinked = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--unlinked") unlinked = true;
    }
    const rows = queryAll(db, unlinked
      ? "SELECT name, status, phase, priority, health FROM projects WHERE node_id IS NULL ORDER BY name"
      : "SELECT name, status, phase, priority, health FROM projects ORDER BY priority");
    if (!rows.length) {
      console.log(unlinked ? "No unlinked projects — all projects are attached to a node." : "No projects found");
      return;
    }
    table(["Name", "Status", "Phase", "Priority", "Health"], rows.map((r: any) => [r.name, r.status, r.phase, r.priority, r.health]));
  },

  "project:get": async (db, args) => {
    requireArgs(1, "<name>", "project", "get", args);
    const p = queryOne(db, "SELECT * FROM projects WHERE name = ?", [args[0]]) as any;
    if (!p) { console.log(`Project "${args[0]}" not found`); return; }
    console.log(`${p.name} | ${p.status} | ${p.phase} | ${p.priority} | ${p.health}`);
    console.log(`  Stack: ${p.tech_stack || "none"}`);
    console.log(`  Path: ${p.repo_path || "none"}`);
    const tools = queryAll(db, "SELECT tool_name, category, priority FROM tooling WHERE project_id = ? ORDER BY priority", [p.id]);
    if (tools.length) {
      console.log("  Tools:");
      for (const t of tools) console.log(`    ${t.tool_name} [${t.category}] ${t.priority}`);
    }
  },

  "project:update": async (db, args) => {
    requireArgs(2, "<name> [<field> <value>] [--node-id <id>]", "project", "update", args);
    const name = args[0]!;
    const project = queryOne(db, "SELECT id FROM projects WHERE name = ?", [name]);
    if (!project) { console.log(`Project "${name}" not found`); return; }
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--node-id" && args[i + 1]) {
        const nodeId = parseInt(args[++i]!);
        if (isNaN(nodeId)) { console.log("Invalid node ID"); return; }
        const node = queryOne(db, "SELECT id FROM portfolio_nodes WHERE id = ?", [nodeId]);
        if (!node) { console.log(`Node #${nodeId} not found`); return; }
        run(db, "UPDATE projects SET node_id = ?, updated_at = datetime('now') WHERE name = ?", [nodeId, name]);
        console.log(`Moved ${name} → node #${nodeId}`);
        return;
      }
    }
    if (args[1] && args[2] && args[1] !== "--node-id") {
      const field = args[1]!;
      const value = args[2]!;
      const allowed = ["status", "phase", "priority", "health"];
      if (!allowed.includes(field)) { console.log(`Field must be one of: ${allowed.join(", ")}`); return; }
      run(db, `UPDATE projects SET ${field} = ? WHERE name = ?`, [value, name]);
      console.log(`Updated ${name}.${field} → ${value}`);
    }
  },

  "project:delete": async (db, args) => {
    requireArgs(1, "<name>", "project", "delete", args);
    console.log(`To delete "${args[0]}", run: bun scripts/pmm.ts project confirm-delete ${args[0]}`);
  },

  "project:confirm-delete": async (db, args) => {
    requireArgs(1, "<name>", "project", "confirm-delete", args);
    const name = args[0]!;
    const project = queryOne(db, "SELECT id FROM projects WHERE name = ?", [name]) as any;
    if (!project) { console.log(`Project "${name}" not found`); return; }
    run(db, "DELETE FROM tooling WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM mcp_servers WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM skills WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM hooks WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM protocol_captures WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM automation_configs WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM compliance_runs WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM integration_edges WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM subagents WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM agent_workers WHERE project_id = ?", [project.id]);
    const pipelines = queryAll(db, "SELECT id FROM pipelines WHERE project_id = ?", [project.id]);
    for (const p of pipelines) { run(db, "DELETE FROM pipeline_steps WHERE pipeline_id = ?", [p.id]); }
    run(db, "DELETE FROM pipelines WHERE project_id = ?", [project.id]);
    run(db, "DELETE FROM projects WHERE id = ?", [project.id]);
    console.log(`Deleted project: ${name}`);
  },

  "project:onboard": async (db, args) => {
    requireArgs(1, "<path> [--mode quick|standard|deep|interactive] [--name <override>]", "project", "onboard", args);
    const onboardPath = args[0]!;
    const discovered = discoverProject(onboardPath);
    let mode = "standard", nameOverride: string | null = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--mode" && args[i + 1]) mode = args[++i]!;
      else if (args[i] === "--name" && args[i + 1]) nameOverride = args[++i]!;
    }
    const finalName = nameOverride || discovered.name;
    const existing = queryOne(db, "SELECT id FROM projects WHERE name = ?", [finalName]);
    if (existing) { console.log(`Project "${finalName}" already registered. Use --update or re-run with a different name.`); return; }
    console.log(`=== PMM Onboard: ${finalName} ===`);
    console.log(`  Path:      ${discovered.repo_path}`);
    console.log(`  Phase:     ${discovered.phase}`);
    console.log(`  Priority:  ${discovered.priority}`);
    console.log(`  Stack:     ${discovered.tech_stack.join(", ") || "(none detected)"}`);
    if (discovered.description) console.log(`  Desc:      ${discovered.description}`);
    if (discovered.git_remote) console.log(`  Git:       ${discovered.git_remote} (${discovered.git_branch || "?"})`);
    console.log(`  Commits:   ${discovered.git_commits}`);
    if (discovered.warnings.length) for (const w of discovered.warnings) console.log(`  ⚠ ${w}`);
    run(db, `INSERT INTO projects (name, status, phase, priority, repo_path, tech_stack, health) VALUES (?, 'active', ?, ?, ?, ?, 'healthy')`,
      [finalName, discovered.phase, discovered.priority, discovered.repo_path, JSON.stringify(discovered.tech_stack)]);
    const pid = db.query("SELECT last_insert_rowid() AS id").get() as any;
    console.log(`\nRegistered: ${finalName} (#${pid.id}) [${discovered.phase}/${discovered.priority}]`);
    if ((mode === "standard" || mode === "deep") && discovered.tools.length > 0) {
      console.log(`\nTools (${discovered.tools.length}):`);
      const toolStmt = db.prepare("INSERT INTO tooling (project_id, tool_name, category, priority) VALUES (?, ?, ?, ?)");
      for (const t of discovered.tools) { toolStmt.run(pid.id, t.name, t.category, t.priority); console.log(`  + ${t.name} [${t.category}] ${t.priority}`); }
      toolStmt.finalize();
    }
    if (discovered.git_remote) {
      try { run(db, "INSERT INTO tooling (project_id, tool_name, category, priority) VALUES (?, ?, 'vcs', 'high')", [pid.id, `git: ${discovered.git_remote}`]); } catch (_) {}
    }
    console.log(`\nMode: ${mode}`);
    if (mode === "deep") {
      console.log("---");
      console.log("Deep mode: spawn pmm-onboarder agent for full discovery:");
      console.log(`  bun scripts/pmm.ts worker dispatch pmm-onboarder sonnet "Deep onboard ${finalName} at ${discovered.repo_path}" --project ${finalName}`);
    } else if (mode === "interactive") {
      console.log("Interactive mode: review each step with confirmation.");
      console.log("Use /pmm-onboard for the interactive skill workflow.");
    }
    if (mode !== "deep") {
      console.log(`\nNext: bun scripts/pmm.ts project get ${finalName}`);
      console.log(`      bun scripts/pmm.ts standards check ${finalName}`);
    }
  },

  "project:discover": async (db, args) => {
    requireArgs(1, "<path> [--json]", "project", "discover", args);
    let jsonOut = false;
    for (let i = 1; i < args.length; i++) { if (args[i] === "--json") jsonOut = true; }
    const discovered = discoverProject(args[0]!);
    if (jsonOut) {
      console.log(JSON.stringify(discovered, null, 2));
    } else {
      console.log(`=== Discovered: ${discovered.name} ===`);
      console.log(`  Path:      ${discovered.repo_path}`);
      console.log(`  Phase:     ${discovered.phase}`);
      console.log(`  Priority:  ${discovered.priority}`);
      console.log(`  Stack:     ${discovered.tech_stack.join(", ") || "(none)"}`);
      if (discovered.description) console.log(`  Desc:      ${discovered.description}`);
      if (discovered.git_remote) console.log(`  Git:       ${discovered.git_remote} (${discovered.git_branch || "?"})`);
      console.log(`  Commits:   ${discovered.git_commits}`);
      if (discovered.tools.length > 0) {
        console.log(`  Tools (${discovered.tools.length}):`);
        for (const t of discovered.tools) console.log(`    ${t.name} [${t.category}] ${t.priority}`);
      }
      if (discovered.warnings.length) for (const w of discovered.warnings) console.log(`  ⚠ ${w}`);
    }
  },

  "project:discover-all": async (db, args) => {
    const startDir = args[0] || process.cwd();
    let jsonOut = false, maxDepth = 2;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--json") jsonOut = true;
      else if (args[i] === "--depth" && args[i + 1]) maxDepth = parseInt(args[++i]!);
    }
    const fs = require("node:fs");
    const path = require("node:path");
    const candidates: any[] = [];
    function scanDir(dir: string, depth: number) {
      if (depth > maxDepth) return;
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const full = path.join(dir, entry);
          try { if (!fs.statSync(full).isDirectory()) continue; } catch (_) { continue; }
          if (entry.startsWith(".") || entry === "node_modules" || entry === "PMM") continue;
          const signals = ["package.json", "README.md", "pyproject.toml", "Cargo.toml", "go.mod", ".git"];
          const hasSignal = signals.some((s: string) => fs.existsSync(path.join(full, s)));
          if (hasSignal) {
            try { const d: any = discoverProject(full); d._path = full.replace(/\\/g, "/"); candidates.push(d); } catch (_) {}
          }
          scanDir(full, depth + 1);
        }
      } catch (_) {}
    }
    scanDir(startDir, 0);
    if (jsonOut) {
      console.log(JSON.stringify(candidates, null, 2));
    } else {
      console.log(`Found ${candidates.length} project candidate(s):\n`);
      for (const c of candidates) {
        console.log(`  ${c.name}  [${c.phase}/${c.priority}]  ${c.tech_stack.join(", ") || "?"}`);
        console.log(`    path: ${c._path}`);
        if (c.description) console.log(`    desc: ${c.description}`);
      }
    }
  },

  // ── Tool commands ────────────────────────────────────
  "tool:add": async (db, args) => {
    requireArgs(2, '<project> <tool-name> [--category <cat>] [--priority <p>] [--desc "..."]', "tool", "add", args);
    const projectName = args[0]!;
    const toolName = args[1]!;
    const pid = getProjectIdOrFail(db, projectName);
    let category: string | null = null, priority = "medium", desc: string | null = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--category" && args[i + 1]) category = args[++i]!;
      else if (args[i] === "--priority" && args[i + 1]) priority = args[++i]!;
      else if (args[i] === "--desc" && args[i + 1]) desc = args[++i]!;
    }
    run(db, `INSERT OR REPLACE INTO tooling (project_id, tool_name, category, status, description, priority, pricing, setup_effort) VALUES (?, ?, ?, 'active', ?, ?, 'free', 'low')`,
      [pid, toolName, category, desc, priority]);
    console.log(`Registered tool: ${toolName} → ${projectName}`);
  },

  "tool:list": async (db, _args) => {
    const rows = queryAll(db, `SELECT t.tool_name, p.name as project, t.category, t.priority FROM tooling t JOIN projects p ON t.project_id = p.id ORDER BY t.priority, p.name`);
    table(["Tool", "Project", "Category", "Priority"], rows.map((r: any) => [r.tool_name, r.project, r.category, r.priority]));
  },
};
