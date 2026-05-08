/**
 * PMM Swarm + Layer + Exec Commands
 * ==================================
 * swarm init/pool/task/checkout/checkin/approve/reject/escalate/audit/export/status
 * layer define/list/update
 * exec harnesses/harness/onboard-harness/inject
 */
import type { Database } from "bun:sqlite";
import { getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";
import { ROUTING_CODES, buildHandoffManifest } from "./shared-swarm";
import { __prompt } from "./discovery";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ swarm ═══════════════════════════════════════════
  "swarm:init": async (db, args) => {
    requireArgs(1, '<project> [--from-plan] [--routing-code <N>] [--topology hierarchical] [--consensus L0-authority]', "swarm", "init", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let fromPlan = false, routingCode = 3, topology = "hierarchical", consensus = "L0-authority";
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--from-plan") fromPlan = true;
      else if (args[i] === "--routing-code" && args[i + 1]) routingCode = parseInt(args[++i]!);
      else if (args[i] === "--topology" && args[i + 1]) topology = args[++i]!;
      else if (args[i] === "--consensus" && args[i + 1]) consensus = args[++i]!;
    }
    const rc = ROUTING_CODES[routingCode];
    if (!rc) { console.log(`Unknown routing code: ${routingCode}. Valid: ${Object.keys(ROUTING_CODES).join(", ")}`); return; }
    console.log(`=== Swarm Init: ${projectName} ===`);
    console.log(`  Routing:  code ${routingCode} — ${rc.name} (${rc.description})`);
    console.log(`  Pipeline: ${rc.pipeline.join(" → ")}`);
    console.log(`  Topology: ${topology}`);
    console.log(`  Consensus: ${consensus}`);
    const existingLayers = queryAll(db, "SELECT layer_num FROM agent_layers WHERE project_id = ?", [pid]);
    const existingNums = new Set(existingLayers.map((l: any) => l.layer_num));
    const neededNums = rc.pipeline.map((p: string) => parseInt(p.replace("L", "")));
    const defaultNames: Record<number, string> = { 0: "Architecture & Design", 1: "Scaffolding & Dependencies", 2: "Algorithms & Core Logic", 3: "Research & Standards", 4: "Implementation" };
    for (const ln of neededNums) {
      if (!existingNums.has(ln)) {
        run(db, `INSERT INTO agent_layers (project_id, layer_num, name, topology, consensus) VALUES (?,?,?,?,?)`, [pid, ln, defaultNames[ln] || `Layer ${ln}`, topology, consensus]);
        console.log(`  + Auto-defined L${ln}: ${defaultNames[ln] || `Layer ${ln}`}`);
      }
    }
    console.log(`\nReady. Next steps:`);
    console.log(`  bun scripts/pmm.ts layer list ${projectName}`);
    console.log(`  bun scripts/pmm.ts swarm pool ${projectName}`);
    console.log(`  bun scripts/cli.ts swarm deploy ${projectName} --dry-run`);
    console.log(`  bun scripts/cli.ts swarm export ${projectName}`);
  },


  "swarm:deploy": async (db, args) => {
    requireArgs(1, "<project> [--layer L#] [--max-parallel 5] [--dry-run] [--model haiku|sonnet|opus]", "swarm", "deploy", args);
    const projectName = args[0];
    let layer = undefined, maxParallel = 5, dryRun = false, modelOverride = undefined;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--layer" && args[i + 1]) layer = parseInt(args[++i].replace("L", ""));
      else if (args[i] === "--max-parallel" && args[i + 1]) maxParallel = parseInt(args[++i]);
      else if (args[i] === "--dry-run") dryRun = true;
      else if (args[i] === "--model" && args[i + 1]) modelOverride = args[++i];
    }
    const { buildDeployPlan } = await import("../execution/deploy");
    const plan = buildDeployPlan(db, projectName, { layer, max_parallel: maxParallel, dry_run: dryRun, model_override: modelOverride });
    console.log("=== Swarm Deploy: " + projectName + (dryRun ? " (DRY RUN)" : "") + " ===");
    console.log("  Completed: " + plan.completed_count + "  Ready: " + plan.ready_tasks.length + "  Blocked: " + plan.blocked_tasks.length);
    console.log("");
    console.log(plan.execution_note);
    if (plan.swarm_complete) { console.log("\n=== Swarm complete! ==="); return; }
    if (plan.ready_tasks.length === 0) {
      if (plan.blocked_tasks.length > 0) {
        console.log("\nBlocked tasks:");
        for (const bt of plan.blocked_tasks) console.log("  #" + bt.task_id + " L" + bt.layer_num + ": " + bt.title + " (blocked by: [" + bt.blocked_by.join(", ") + "])");
      }
      return;
    }
    console.log("\n\n--- Task() Calls (copy into Claude Code) ---");
    for (const rt of plan.ready_tasks) {
      console.log("\n# [Worker #" + rt.worker_id + "] " + rt.agent_type + " (" + rt.model + ") L" + rt.layer_num + (rt.track_letter ? "." + rt.track_letter : "") + ": " + rt.title);
      console.log(rt.task_call);
    }
    if (plan.blocked_tasks.length > 0) {
      console.log("\n--- " + plan.blocked_tasks.length + " tasks blocked ---");
      for (const bt of plan.blocked_tasks) console.log("  #" + bt.task_id + ": " + bt.title);
    }
    if (!dryRun) {
      const wids = plan.ready_tasks.map((t) => t.worker_id).join(",");
      console.log("\n--- After tasks complete, run ---");
      console.log("bun scripts/cli.ts swarm collect " + projectName + " --workers " + wids);
    }
  },

  "swarm:collect": async (db, args) => {
    requireArgs(2, "<project> --workers <id1,id2,...>", "swarm", "collect", args);
    const projectName = args[0];
    let workerIds = [], summaries = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--workers" && args[i + 1]) workerIds = args[++i].split(",").map(Number).filter((n) => !isNaN(n));
      else if (args[i] === "--summaries" && args[i + 1]) { try { summaries = JSON.parse(args[++i]); } catch { console.log("Warning: --summaries JSON invalid"); } }
    }
    if (workerIds.length === 0) { console.log("--workers required (comma-separated worker IDs)"); return; }
    const { advanceSwarm } = await import("../execution/deploy");
    const plan = advanceSwarm(db, projectName, { completed_worker_ids: workerIds, summaries });
    console.log("=== Swarm Collect: " + projectName + " ===");
    console.log("  Marked " + workerIds.length + " workers complete. Total done: " + plan.completed_count);
    console.log("  Next wave: " + plan.ready_tasks.length + " ready, " + plan.blocked_tasks.length + " still blocked");
    if (plan.swarm_complete) { console.log("\n=== Swarm complete! All tasks finished. ==="); return; }
    if (plan.ready_tasks.length > 0) {
      console.log("\n--- Next Wave: Task() Calls ---");
      for (const rt of plan.ready_tasks) {
        console.log("\n# [Worker #" + rt.worker_id + "] " + rt.agent_type + " (" + rt.model + ") L" + rt.layer_num + ": " + rt.title);
        console.log(rt.task_call);
      }
      const wids = plan.ready_tasks.map((t) => t.worker_id).join(",");
      console.log("\nbun scripts/cli.ts swarm collect " + projectName + " --workers " + wids);
    }
  },

  "swarm:pool": async (db, args) => {
    requireArgs(1, '<project> [--format table|json] [--status pending] [--layer L#]', "swarm", "pool", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let format = "table", statusFilter: string | null = null, layerFilter: number | null = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--format" && args[i + 1]) format = args[++i]!;
      else if (args[i] === "--status" && args[i + 1]) statusFilter = args[++i]!;
      else if (args[i] === "--layer" && args[i + 1]) layerFilter = parseInt(args[++i]!.replace("L", ""));
    }
    let filter = "WHERE project_id = ?";
    const params: any[] = [pid];
    if (statusFilter) { filter += " AND status = ?"; params.push(statusFilter); }
    if (layerFilter !== null) { filter += " AND layer_num = ?"; params.push(layerFilter); }
    const tasks = queryAll(db, `SELECT * FROM swarm_tasks ${filter} ORDER BY layer_num, track_letter`, params);
    if (format === "json") { console.log(JSON.stringify(tasks, null, 2)); return; }
    if (!tasks.length) { console.log("No swarm tasks. Use swarm task add to populate."); return; }
    table(["ID", "L", "Trk", "Code", "Name", "Status", "Deps", "RACI"], tasks.map((t: any) => [String(t.id), `L${t.layer_num}`, t.track_letter || "?", String(t.routing_code || 3), t.name, t.status, t.dependencies ? JSON.parse(t.dependencies).length : 0, `${t.raci_responsible || "?"}/${t.raci_accountable || "?"}`]));
  },

  "swarm:task": async (db, args) => {
    if (args[0] !== "add") { console.log("Usage: swarm task add <project> ..."); return; }
    const projectName = args[1]!;
    const pid = getProjectIdOrFail(db, projectName);
    let name = "", layerNum = 0, trackLetter: string | null = null, routingCode = 3;
    let deps: number[] = [], raciR = "", raciA = "", raciC = "", raciI = "";
    let criteria: string | null = null, description: string | null = null, estTokens: number | null = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--name" && args[i + 1]) name = args[++i]!;
      else if (args[i] === "--layer" && args[i + 1]) layerNum = parseInt(args[++i]!.replace("L", ""));
      else if (args[i] === "--track" && args[i + 1]) trackLetter = args[++i]!;
      else if (args[i] === "--routing-code" && args[i + 1]) routingCode = parseInt(args[++i]!);
      else if (args[i] === "--depends" && args[i + 1]) deps = args[++i]!.split(",").map(Number).filter(n => !isNaN(n));
      else if (args[i] === "--desc" && args[i + 1]) description = args[++i]!;
      else if (args[i] === "--criteria" && args[i + 1]) criteria = args[++i]!;
      else if (args[i] === "--est-tokens" && args[i + 1]) estTokens = parseInt(args[++i]!);
      else if (args[i] === "--raci" && args[i + 1]) {
        const raciDef = args[++i]!;
        for (const part of raciDef.split(",")) { const [role, value] = part.split(":") as [string, string]; if (role === "R") raciR = value; else if (role === "A") raciA = value; else if (role === "C") raciC = value; else if (role === "I") raciI = value; }
      }
    }
    if (!name) { console.log("--name required"); return; }
    run(db, `INSERT INTO swarm_tasks (project_id, layer_num, track_letter, routing_code, name, description, acceptance_criteria, dependencies, raci_responsible, raci_accountable, raci_consulted, raci_informed, estimated_tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, layerNum, trackLetter, routingCode, name, description, criteria, JSON.stringify(deps), raciR, raciA, raciC, raciI, estTokens]);
    const task = queryOne(db, "SELECT id FROM swarm_tasks ORDER BY id DESC LIMIT 1") as any;
    console.log(`Swarm task #${task.id}: ${name} [L${layerNum}${trackLetter ? "." + trackLetter : ""}] code=${routingCode}`);
  },

  "swarm:checkout": async (db, args) => {
    requireArgs(2, '<project> <task-id> --worker <id>', "swarm", "checkout", args);
    const projectName = args[0]!; const taskId = parseInt(args[1]!);
    const pid = getProjectIdOrFail(db, projectName);
    let workerId: number | null = null;
    for (let i = 2; i < args.length; i++) { if (args[i] === "--worker" && args[i + 1]) workerId = parseInt(args[++i]!); }
    const task = queryOne(db, "SELECT * FROM swarm_tasks WHERE id = ? AND project_id = ?", [taskId, pid]) as any;
    if (!task) { console.log(`Task #${taskId} not found`); return; }
    if (task.status !== "pending") { console.log(`Task #${taskId} is ${task.status}, not pending`); return; }
    if (task.dependencies) {
      const depIds = JSON.parse(task.dependencies);
      const incomplete = queryAll(db, `SELECT id, name FROM swarm_tasks WHERE id IN (${depIds.map(() => "?").join(",")}) AND status != 'completed'`, depIds);
      if (incomplete.length) { console.log(`Cannot check out: ${incomplete.length} dependencies not completed:`); for (const d of incomplete) console.log(`  #${d.id}: ${d.name}`); return; }
    }
    run(db, "UPDATE swarm_tasks SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [workerId, taskId]);
    if (workerId) run(db, "UPDATE agent_workers SET swarm_task_id = ?, layer_num = ?, track_letter = ?, routing_code = ? WHERE id = ?", [taskId, task.layer_num, task.track_letter, task.routing_code, workerId]);
    run(db, "INSERT INTO swarm_audit_log (project_id, task_id, worker_id, action, layer_num, track_letter) VALUES (?,?,?, 'checkout', ?,?)", [pid, taskId, workerId, task.layer_num, task.track_letter]);
    console.log(`Task #${taskId} checked out by worker #${workerId || "?"} [L${task.layer_num}${task.track_letter ? "." + task.track_letter : ""}]`);
  },

  "swarm:checkin": async (db, args) => {
    requireArgs(2, '<project> <task-id> --worker <id> [--evidence "{...}"]', "swarm", "checkin", args);
    const projectName = args[0]!; const taskId = parseInt(args[1]!);
    const pid = getProjectIdOrFail(db, projectName);
    let workerId: number | null = null, evidence: string | null = null;
    for (let i = 2; i < args.length; i++) { if (args[i] === "--worker" && args[i + 1]) workerId = parseInt(args[++i]!); else if (args[i] === "--evidence" && args[i + 1]) evidence = args[++i]!; }
    const task = queryOne(db, "SELECT * FROM swarm_tasks WHERE id = ? AND project_id = ?", [taskId, pid]) as any;
    if (!task) { console.log(`Task #${taskId} not found`); return; }
    if (!["claimed", "in_progress"].includes(task.status)) { console.log(`Task #${taskId} is ${task.status}, not claimed`); return; }
    const newStatus = task.raci_accountable && task.raci_accountable !== task.claimed_by ? "review" : "completed";
    run(db, "UPDATE swarm_tasks SET status = ?, submitted_at = datetime('now'), evidence = ?, updated_at = datetime('now') WHERE id = ?", [newStatus, evidence, taskId]);
    run(db, "INSERT INTO swarm_audit_log (project_id, task_id, worker_id, action, layer_num, track_letter, details) VALUES (?,?,?, 'checkin', ?,?,?)", [pid, taskId, workerId, task.layer_num, task.track_letter, evidence]);
    console.log(`Task #${taskId} checked in → ${newStatus}${newStatus === "review" ? " (awaiting RACI approval)" : ""}`);
  },

  "swarm:approve": async (db, args) => {
    requireArgs(2, '<project> <task-id> [--comment "..."]', "swarm", "approve", args);
    const projectName = args[0]!; const taskId = parseInt(args[1]!);
    const pid = getProjectIdOrFail(db, projectName);
    let comment: string | null = null;
    for (let i = 2; i < args.length; i++) if (args[i] === "--comment" && args[i + 1]) comment = args[++i]!;
    run(db, "UPDATE swarm_tasks SET status = 'completed', completed_at = datetime('now'), review_comment = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?", [comment, taskId, pid]);
    run(db, "INSERT INTO swarm_audit_log (project_id, task_id, action, details) VALUES (?,?, 'approve', ?)", [pid, taskId, comment]);
    console.log(`Task #${taskId} approved → completed`);
  },

  "swarm:reject": async (db, args) => {
    requireArgs(2, '<project> <task-id> --reason "..."', "swarm", "reject", args);
    const projectName = args[0]!; const taskId = parseInt(args[1]!);
    const pid = getProjectIdOrFail(db, projectName);
    let reason = "";
    for (let i = 2; i < args.length; i++) if (args[i] === "--reason" && args[i + 1]) reason = args[++i]!;
    run(db, "UPDATE swarm_tasks SET status = 'pending', review_comment = ?, claimed_by = NULL, updated_at = datetime('now') WHERE id = ? AND project_id = ?", [reason, taskId, pid]);
    run(db, "INSERT INTO swarm_audit_log (project_id, task_id, action, details) VALUES (?,?, 'reject', ?)", [pid, taskId, reason]);
    console.log(`Task #${taskId} rejected → returned to pool. Reason: ${reason}`);
  },

  "swarm:escalate": async (db, args) => {
    requireArgs(2, '<project> <task-id> --to-layer L# --severity P1|P2 --reason "..."', "swarm", "escalate", args);
    const projectName = args[0]!; const taskId = parseInt(args[1]!);
    const pid = getProjectIdOrFail(db, projectName);
    let toLayer: number | null = null, severity = "P2", reason = "";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--to-layer" && args[i + 1]) toLayer = parseInt(args[++i]!.replace("L", ""));
      else if (args[i] === "--severity" && args[i + 1]) severity = args[++i]!;
      else if (args[i] === "--reason" && args[i + 1]) reason = args[++i]!;
    }
    if (toLayer === null) { console.log("--to-layer required"); return; }
    const task = queryOne(db, "SELECT * FROM swarm_tasks WHERE id = ? AND project_id = ?", [taskId, pid]) as any;
    if (!task) { console.log(`Task #${taskId} not found`); return; }
    run(db, "UPDATE swarm_tasks SET status = 'escalated', escalated_to = ?, escalation_reason = ?, updated_at = datetime('now') WHERE id = ?", [toLayer, reason, taskId]);
    run(db, "INSERT INTO swarm_escalations (project_id, task_id, from_layer, to_layer, reason, severity) VALUES (?,?,?,?,?,?)", [pid, taskId, task.layer_num, toLayer, reason, severity]);
    run(db, "INSERT INTO swarm_audit_log (project_id, task_id, action, details) VALUES (?,?, 'escalate', ?)", [pid, taskId, `L${task.layer_num}→L${toLayer} [${severity}]: ${reason}`]);
    console.log(`Task #${taskId} escalated: L${task.layer_num} → L${toLayer} [${severity}]`);
    if (severity === "P0") console.log("  ⚠ P0 severity: all dependent tracks halted until resolved.");
  },

  "swarm:audit": async (db, args) => {
    requireArgs(2, '<project> <worker-id> <action> [details-json]', "swarm", "audit", args);
    const projectName = args[0]!; const workerId = parseInt(args[1]!);
    const action = args[2]!; const details = args[3] || null;
    const pid = getProjectIdOrFail(db, projectName);
    const worker = queryOne(db, "SELECT * FROM agent_workers WHERE id = ?", [workerId]) as any;
    const layerNum = worker?.layer_num || null;
    const trackLetter = worker?.track_letter || null;
    run(db, "INSERT INTO swarm_audit_log (project_id, task_id, worker_id, action, layer_num, track_letter, details) VALUES (?,?,?,?,?,?,?)", [pid, worker?.swarm_task_id || null, workerId, action, layerNum, trackLetter, details]);
    console.log(`Audit: worker #${workerId} → ${action}${details ? " " + details.substring(0, 80) : ""}`);
  },

  "swarm:export": async (db, args) => {
    requireArgs(1, '<project> [--format json|markdown] [--output <path>] [--include-completed]', "swarm", "export", args);
    const projectName = args[0]!;
    const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [projectName]) as any;
    if (!project) { console.log(`Project "${projectName}" not registered`); return; }
    const pid = project.id;
    let format = "json", outputPath: string | null = null, includeCompleted = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--format" && args[i + 1]) format = args[++i]!;
      else if (args[i] === "--output" && args[i + 1]) outputPath = args[++i]!;
      else if (args[i] === "--include-completed") includeCompleted = true;
    }
    const layers = queryAll(db, "SELECT * FROM agent_layers WHERE project_id = ? ORDER BY layer_num", [pid]);
    const tracks = queryAll(db, `SELECT t.*, l.layer_num FROM agent_tracks t JOIN agent_layers l ON t.layer_id = l.id WHERE l.project_id = ? ORDER BY l.layer_num, t.track_letter`, [pid]);
    const tasks = queryAll(db, "SELECT * FROM swarm_tasks WHERE project_id = ? ORDER BY layer_num, track_letter", [pid]);
    const manifest = buildHandoffManifest(projectName, project, layers, tracks, tasks, { includeCompleted, targetFormat: format });

    if (format === "markdown") {
      let md = `# Swarm Handoff Manifest: ${projectName}\n`;
      md += `> Generated: ${manifest.generated_at} | Version: ${manifest.handoff_version}\n`;
      md += `> Ready for execution: ${manifest.ready_for_execution} tasks | Est. tokens: ${manifest.total_estimated_tokens.toLocaleString()}\n\n`;
      md += `## Project\n- **Phase:** ${manifest.project.phase}\n- **Stack:** ${manifest.project.tech_stack.join(", ") || "none"}\n- **Path:** ${manifest.project.repo_path}\n\n`;
      md += `## Layers\n`;
      for (const l of manifest.layers) {
        md += `### L${l.num}: ${l.name}\n- Topology: ${l.topology} | Consensus: ${l.consensus} | Checkpoint: every ${l.checkpoint_interval} tasks\n`;
        md += `- Tracks:\n`;
        for (const t of l.tracks) { md += `  - **${t.letter}**: ${t.name} [${t.role}] agent=${t.agent} model=${t.model} iso=${t.isolation_mode}\n`; if (t.file_domain) md += `    - Files: \`${t.file_domain}\`\n`; }
      }
      md += `\n## Tasks\n`;
      for (const t of manifest.tasks) {
        md += `### #${t.id} L${t.layer_num}${t.track_letter ? "." + t.track_letter : ""}: ${t.name}\n`;
        md += `- Status: ${t.status} | Code: ${t.routing_code} | Est. tokens: ${t.estimated_tokens || "?"}\n`;
        if (t.acceptance_criteria) md += `- Criteria: ${t.acceptance_criteria}\n`;
        if (t.dependencies.length) md += `- Depends on: ${t.dependencies.join(", ")}\n`;
        md += `- RACI: R=${t.raci.R} A=${t.raci.A} C=${t.raci.C} I=${t.raci.I}\n\n`;
      }
      md += `\n## Execution Order\n${manifest.execution_order.join(" → ")}\n`;
      md += `\n## Routing Codes Used\n`;
      for (const [code, info] of Object.entries(manifest.routing_codes_used)) { if (info) md += `- **${code}**: ${(info as any).name} → ${(info as any).pipeline.join(" → ")}\n`; }
      if (outputPath) {
        const fs = require("node:fs"); const path = require("node:path");
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, md);
        console.log(`Handoff written: ${outputPath}`);
      } else { console.log(md); }
    } else {
      if (outputPath) {
        const fs = require("node:fs"); const path = require("node:path");
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
        console.log(`Handoff written: ${outputPath}`);
      } else { console.log(JSON.stringify(manifest, null, 2)); }
      run(db, "INSERT INTO swarm_handoffs (project_id, manifest, layers_count, tasks_count, routing_codes_used, export_path) VALUES (?,?,?,?,?,?)", [pid, JSON.stringify(manifest), manifest.layers.length, manifest.tasks.length, Object.keys(manifest.routing_codes_used).join(","), outputPath]);
    }
  },

  "swarm:status": async (db, args) => {
    requireArgs(1, '<project> [--format table|json|dashboard]', "swarm", "status", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let format = "table";
    for (let i = 1; i < args.length; i++) if (args[i] === "--format" && args[i + 1]) format = args[++i]!;
    const stats = queryOne(db, `SELECT status, COUNT(*) as c FROM swarm_tasks WHERE project_id = ? GROUP BY status`, [pid]) as any;
    const layers = queryAll(db, "SELECT * FROM agent_layers WHERE project_id = ? ORDER BY layer_num", [pid]);
    if (format === "json") {
      const layerDetails = layers.map((l: any) => { const ltasks = queryAll(db, "SELECT status, COUNT(*) as c FROM swarm_tasks WHERE project_id = ? AND layer_num = ? GROUP BY status", [pid, l.layer_num]); return { layer_num: l.layer_num, name: l.name, tasks: ltasks }; });
      console.log(JSON.stringify({ project: projectName, stats, layers: layerDetails }, null, 2));
    } else {
      console.log(`=== Swarm Status: ${projectName} ===`);
      if (stats) {
        const statusCounts: Record<string, number> = {};
        for (const s of [stats].flat()) if (s) statusCounts[s.status] = s.c;
        console.log(`  pending:${statusCounts.pending || 0}  claimed:${statusCounts.claimed || 0}  in_progress:${statusCounts.in_progress || 0}  review:${statusCounts.review || 0}  completed:${statusCounts.completed || 0}  escalated:${statusCounts.escalated || 0}`);
      }
      for (const l of layers) {
        const ltasks = queryAll(db, "SELECT status, COUNT(*) as c FROM swarm_tasks WHERE project_id = ? AND layer_num = ? GROUP BY status", [pid, l.layer_num]);
        const counts: Record<string, number> = {};
        for (const lt of ltasks) counts[lt.status] = lt.c;
        console.log(`  L${l.layer_num}: ${l.name} | done:${counts.completed || 0} active:${(counts.claimed || 0) + (counts.in_progress || 0)} pending:${counts.pending || 0}`);
      }
    }
  },

  // ═══ layer ═══════════════════════════════════════════
  "layer:define": async (db, args) => {
    requireArgs(3, '<project> <L#> --name "..." [--tracks A:name:role:agent:model,...] [--topology hierarchical] [--consensus L0-authority] [--checkpoint 5]', "layer", "define", args);
    const projectName = args[0]!;
    const layerNum = parseInt(args[1]!.replace("L", ""));
    if (isNaN(layerNum) || layerNum < 0) { console.log("Layer number must be >= 0"); return; }
    const pid = getProjectIdOrFail(db, projectName);
    let name = "", description: string | null = null, topology = "hierarchical", consensus = "L0-authority", checkpointInterval = 5, maxTracks = 3;
    let tracksDef = "";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--name" && args[i + 1]) name = args[++i]!;
      else if (args[i] === "--desc" && args[i + 1]) description = args[++i]!;
      else if (args[i] === "--topology" && args[i + 1]) topology = args[++i]!;
      else if (args[i] === "--consensus" && args[i + 1]) consensus = args[++i]!;
      else if (args[i] === "--checkpoint" && args[i + 1]) checkpointInterval = parseInt(args[++i]!);
      else if (args[i] === "--tracks" && args[i + 1]) tracksDef = args[++i]!;
      else if (args[i] === "--max-tracks" && args[i + 1]) maxTracks = parseInt(args[++i]!);
    }
    if (!name) { console.log("--name required"); return; }
    const existing = queryOne(db, "SELECT id FROM agent_layers WHERE project_id = ? AND layer_num = ?", [pid, layerNum]);
    if (existing) { console.log(`L${layerNum} already defined for ${projectName}. Use layer update to modify.`); return; }
    run(db, `INSERT INTO agent_layers (project_id, layer_num, name, description, topology, consensus, checkpoint_interval, max_tracks) VALUES (?,?,?,?,?,?,?,?)`, [pid, layerNum, name, description, topology, consensus, checkpointInterval, maxTracks]);
    const layerId = (db.query("SELECT last_insert_rowid() AS id").get() as any).id;
    console.log(`Defined L${layerNum}: ${name} [${topology}/${consensus}] (#${layerId})`);
    if (tracksDef) {
      const trackParts = tracksDef.split(",");
      for (const part of trackParts) {
        const [letter, trackName, role, agent, model] = part.split(":");
        if (letter && trackName && role) {
          run(db, `INSERT INTO agent_tracks (layer_id, track_letter, name, role, assigned_agent, assigned_model) VALUES (?,?,?,?,?,?)`, [layerId, letter.trim(), trackName.trim(), role.trim(), agent?.trim() || null, model?.trim() || "sonnet"]);
          console.log(`  + Track ${letter.trim()}: ${trackName.trim()} [${role.trim()}] ${agent?.trim() || "unassigned"}`);
        }
      }
    }
  },

  "layer:list": async (db, args) => {
    requireArgs(1, "<project> [--format table|json]", "layer", "list", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let format = "table";
    for (let i = 1; i < args.length; i++) if (args[i] === "--format" && args[i + 1]) format = args[++i]!;
    const layers = queryAll(db, `SELECT l.*, (SELECT COUNT(*) FROM agent_tracks WHERE layer_id = l.id) as track_count FROM agent_layers l WHERE project_id = ? ORDER BY l.layer_num`, [pid]);
    if (format === "json") {
      const result: any[] = [];
      for (const l of layers) { const tracks = queryAll(db, "SELECT * FROM agent_tracks WHERE layer_id = ? ORDER BY track_letter", [l.id]); result.push({ ...l, tracks }); }
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (!layers.length) { console.log("No layers defined. Use: bun scripts/pmm.ts layer define <project> <L#> --name \"...\""); return; }
      for (const l of layers) {
        console.log(`\nL${l.layer_num}: ${l.name} [${l.topology}/${l.consensus}] checkpoint:${l.checkpoint_interval} maxTracks:${l.max_tracks}`);
        const tracks = queryAll(db, "SELECT * FROM agent_tracks WHERE layer_id = ? ORDER BY track_letter", [l.id]);
        for (const t of tracks) console.log(`  ${t.track_letter}: ${t.name} [${t.role}] agent=${t.assigned_agent || "?"} model=${t.assigned_model} isolation=${t.isolation_mode}`);
      }
    }
  },

  "layer:update": async (db, args) => {
    requireArgs(3, '<project> <L#> [--active|--inactive] [--add-track A:name:role:agent:model] [--remove-track A]', "layer", "update", args);
    const projectName = args[0]!;
    const layerNum = parseInt(args[1]!.replace("L", ""));
    const pid = getProjectIdOrFail(db, projectName);
    const layer = queryOne(db, "SELECT * FROM agent_layers WHERE project_id = ? AND layer_num = ?", [pid, layerNum]) as any;
    if (!layer) { console.log(`L${layerNum} not defined for ${projectName}`); return; }
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--active") run(db, "UPDATE agent_tracks SET is_active = 1 WHERE layer_id = ?", [layer.id]);
      else if (args[i] === "--inactive") run(db, "UPDATE agent_tracks SET is_active = 0 WHERE layer_id = ?", [layer.id]);
      else if (args[i] === "--add-track" && args[i + 1]) {
        const def = args[++i]!;
        const [letter, trackName, role, agent, model] = def.split(":");
        if (letter && trackName && role) { run(db, `INSERT OR REPLACE INTO agent_tracks (layer_id, track_letter, name, role, assigned_agent, assigned_model) VALUES (?,?,?,?,?,?)`, [layer.id, letter.trim(), trackName.trim(), role.trim(), agent?.trim() || null, model?.trim() || "sonnet"]); console.log(`  + Track ${letter}: ${trackName}`); }
      } else if (args[i] === "--remove-track" && args[i + 1]) { const letter = args[++i]!; run(db, "DELETE FROM agent_tracks WHERE layer_id = ? AND track_letter = ?", [layer.id, letter]); console.log(`  - Track ${letter} removed`); }
    }
  },

  // ═══ exec (harness management) ═══════════════════════
  "exec:harnesses": async (db, _args) => {
    const registry = JSON.parse(require("fs").readFileSync(require("path").join(import.meta.dir, "..", "execution", "harnesses", "registry.json"), "utf-8"));
    const rows = Object.entries(registry.harnesses).map(([key, h]: [string, any]) => [key, h.name, h.status, h.agent_spawn, h.skill_invoke, h.command_run]);
    table(["Key", "Name", "Status", "Agent Spawn", "Skill Invoke", "Command Run"], rows);
  },

  "exec:harness": async (db, args) => {
    const harnessSub = args[0]; const harnessName = args[1];
    if (!harnessSub || (harnessSub !== "get" && harnessSub !== "remove") || !harnessName) { console.log("Usage: bun scripts/pmm.ts exec harness <get|remove> <name>"); return; }
    const registryPath = require("path").join(import.meta.dir, "..", "execution", "harnesses", "registry.json");
    const registry = JSON.parse(require("fs").readFileSync(registryPath, "utf-8"));
    const matchKey = Object.keys(registry.harnesses).find((k: string) => k.toLowerCase() === harnessName.toLowerCase());
    if (!matchKey) { console.log(`Harness '${harnessName}' not found in registry. Run 'exec harnesses' to see available harnesses.`); return; }
    const harness = registry.harnesses[matchKey];
    if (harnessSub === "get") { for (const [key, value] of Object.entries(harness)) { const formatted = Array.isArray(value) ? value.join(", ") : String(value); console.log(`${key}: ${formatted}`); } }
    else if (harnessSub === "remove") {
      if (matchKey === "claude-code") { console.log("Cannot remove active harness 'claude-code'."); return; }
      const answer = await __prompt(`Remove harness '${matchKey}'? This cannot be undone. [y/N]: `);
      if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") { delete registry.harnesses[matchKey]; require("fs").writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8"); console.log(`✓ Removed harness '${matchKey}' from registry.`); }
    }
  },

  "exec:onboard-harness": async (db, args) => {
    const nameIdx = args.indexOf("--name"); const pathIdx = args.indexOf("--path");
    if (nameIdx >= 0) {
      const hName = args[nameIdx + 1];
      if (!hName) { console.log("Usage: bun scripts/pmm.ts exec onboard-harness --name <name> [--path <path>]"); return; }
      const discoveredProfile: Record<string, any> = {};
      if (pathIdx >= 0) { const hPath = args[pathIdx + 1]; const { discoverHarness } = require("../execution/harnesses/discover"); const result = discoverHarness(hPath); Object.assign(discoveredProfile, result.profile); console.log(`Detected profile for '${result.harnessName}' (confidence: ${result.confidence}):`); for (const [key, value] of Object.entries(result.profile)) { const formatted = Array.isArray(value) ? value.join(", ") : String(value); console.log(`  ${key}: ${formatted}`); } if (result.warnings.length > 0) { result.warnings.forEach((w: string) => console.log(`  Warning: ${w}`)); } }
      const registryPath = require("path").join(import.meta.dir, "..", "execution", "harnesses", "registry.json");
      const registry = JSON.parse(require("fs").readFileSync(registryPath, "utf-8"));
      registry.harnesses[hName] = { name: discoveredProfile.name || hName, instruction_file: discoveredProfile.instruction_file || "CLAUDE.md", config_file: discoveredProfile.config_file || "", agent_spawn: discoveredProfile.agent_spawn || "Task", skill_invoke: discoveredProfile.skill_invoke || "Skill", command_run: discoveredProfile.command_run || "Bash", file_read: discoveredProfile.file_read || "Read", file_write: discoveredProfile.file_write || "Write", hook_mechanism: discoveredProfile.hook_mechanism || "", hook_events: discoveredProfile.hook_events || [], adapter_file: discoveredProfile.adapter_file || `adapters/${hName}.ts`, status: "planned" };
      require("fs").writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
      console.log(`✓ Registered harness '${hName}' → planned`);
    } else {
      // Interactive mode omitted for brevity — delegates to same logic as above
      console.log("Interactive mode: use --name <name> [--path <path>] for non-interactive onboarding.");
    }
  },

  "exec:inject": async (db, args) => {
    const harnessIdx = args.indexOf("--harness"); const harnessName = harnessIdx >= 0 ? args[harnessIdx + 1] : undefined;
    const pathIdx = args.indexOf("--path"); const outputDir = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
    const dryRun = args.includes("--dry-run");
    if (!harnessName) { console.log("Usage: bun scripts/pmm.ts exec inject --harness <name> [--path <dir>] [--dry-run]"); console.log("\nAvailable harnesses:"); console.log("  claude-code (active), opencode (planned), kilocode (planned), gemini-cli (planned), antigravity (planned)"); return; }
    const registryPath = require("path").join(import.meta.dir, "..", "execution", "harnesses", "registry.json");
    const registry = JSON.parse(require("fs").readFileSync(registryPath, "utf-8"));
    const matchKey = Object.keys(registry.harnesses).find((k: string) => k.toLowerCase() === harnessName.toLowerCase());
    if (!matchKey) { console.log(`Harness '${harnessName}' not found. Run 'exec harnesses' for available harnesses.`); return; }
    const profile = registry.harnesses[matchKey];
    const { injectHarness } = require("../execution/inject");
    if (dryRun) { const result = injectHarness(profile, { dryRun: true, outputDir }); console.log(`✓ Dry-run for harness '${matchKey}':`); console.log(`  Would create adapter: ${result.adapterPath}`); if (outputDir && result.instructionPath) console.log(`  Would update instruction: ${result.instructionPath}`); }
    else { const result = injectHarness(profile, { outputDir }); console.log(`✓ Created: ${result.adapterPath}`); if (result.instructionPath) console.log(`✓ Updated: ${result.instructionPath}`); }
  },

  // ═══ swarm:visualize ═══════════════════════════════════
  "swarm:visualize": async (db, args) => {
    requireArgs(1, "<project> [--compact]", "swarm", "visualize", args);
    const projectName = args[0]!;
    const compact = args.includes("--compact");
    const { badge, divider } = await import("./shared");
    const pid = getProjectIdOrFail(db, projectName);

    const layers = queryAll(db, "SELECT * FROM agent_layers WHERE project_id = ? ORDER BY layer_num", [pid]) as any[];
    const allTasks = queryAll(db, "SELECT * FROM swarm_tasks WHERE project_id = ? ORDER BY layer_num, track_letter, id", [pid]) as any[];

    if (!allTasks.length) {
      console.log(`\n  No swarm tasks for ${projectName}. Initialize with:`);
      console.log(`    bun scripts/cli.ts swarm init ${projectName}`);
      console.log("");
      return;
    }

    // Build dependency lookup
    const taskById = new Map<number, any>();
    for (const t of allTasks) taskById.set(t.id, t);

    // Compute blocked status
    const blockedBy = new Map<number, number[]>();
    for (const t of allTasks) {
      if (t.dependencies) {
        const depIds: number[] = JSON.parse(t.dependencies);
        const unmet = depIds.filter(id => {
          const dep = taskById.get(id);
          return dep && dep.status !== "completed";
        });
        if (unmet.length) blockedBy.set(t.id, unmet);
      }
    }

    // Stats
    const statusCounts: Record<string, number> = {};
    for (const t of allTasks) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    const totalCount = allTasks.length;
    const completedCount = statusCounts.completed || 0;
    const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Progress bar
    const barWidth = 30;
    const filled = Math.round((progressPct / 100) * barWidth);
    const progressBar = "█".repeat(filled) + "░".repeat(barWidth - filled);

    console.log(`\n${badge(`═══ Swarm: ${projectName} ═══`, "blue")}  ${totalCount} tasks`);
    console.log(`  ${progressBar}  ${progressPct}% complete`);
    console.log(`  ${badge(String(completedCount), "green")} done · ${badge(String(statusCounts.in_progress || 0), "blue")} active · ${badge(String(statusCounts.pending || 0), "yellow")} pending · ${badge(String(statusCounts.escalated || 0), "red")} escalated`);
    console.log("");

    // Render by layer
    const layerMap = new Map<number, any>();
    for (const l of layers) layerMap.set(l.layer_num, l);

    const layerNums = [...new Set(allTasks.map(t => t.layer_num))].sort((a, b) => a - b);

    for (const ln of layerNums) {
      const layer = layerMap.get(ln);
      const layerName = layer?.name || `Layer ${ln}`;
      console.log(`  ${badge(`L${ln}: ${layerName}`, "blue")}`);
      divider("", 54);

      const layerTasks = allTasks.filter(t => t.layer_num === ln);
      for (const t of layerTasks) {
        const icon = t.status === "completed" ? badge("✓", "green")
          : t.status === "in_progress" || t.status === "claimed" ? badge("→", "blue")
          : t.status === "escalated" ? badge("!", "red")
          : t.status === "review" ? badge("◎", "yellow")
          : blockedBy.has(t.id) ? badge("·", "dim")
          : badge("○", "yellow");

        const trackLabel = t.track_letter ? `.${t.track_letter}` : "";
        let line = `  ${icon}  #${String(t.id).padEnd(4)} ${t.name}`;

        // Status annotation
        if (t.status === "completed") {
          line += `  ${badge("(completed)", "dim")}`;
        } else if (t.status === "in_progress" || t.status === "claimed") {
          const workerInfo = t.claimed_by ? `, Worker #${t.claimed_by}` : "";
          line += `  ${badge(`(${t.status}${workerInfo})`, "blue")}`;
        } else if (t.status === "escalated") {
          line += `  ${badge(`(escalated → L${t.escalated_to})`, "red")}`;
        } else if (t.status === "review") {
          line += `  ${badge("(awaiting review)", "yellow")}`;
        } else if (blockedBy.has(t.id)) {
          const deps = blockedBy.get(t.id)!;
          const depNames = deps.map(id => `#${id}`).join(", ");
          line += `  ${badge(`(blocked by ${depNames})`, "dim")}`;
        } else {
          line += `  ${badge("(ready)", "green")}`;
        }

        console.log(line);

        if (!compact && t.acceptance_criteria) {
          console.log(`        ${badge("criteria:", "dim")} ${t.acceptance_criteria.substring(0, 80)}`);
        }
      }
      console.log("");
    }

    // Next ready wave
    const readyTasks = allTasks.filter(t =>
      t.status === "pending" && !blockedBy.has(t.id)
    );

    if (readyTasks.length) {
      console.log(`  ${badge("⚡ NEXT READY WAVE", "green")} (${readyTasks.length} task${readyTasks.length !== 1 ? "s" : ""})`);
      divider("", 54);
      for (const t of readyTasks) {
        console.log(`  ○  #${String(t.id).padEnd(4)} L${t.layer_num}: ${t.name}`);
      }
      console.log(`\n  Deploy: bun scripts/cli.ts swarm deploy ${projectName} --dry-run`);
    } else if (completedCount < totalCount) {
      // Show what's blocking
      const inProgress = allTasks.filter(t => t.status === "in_progress" || t.status === "claimed");
      if (inProgress.length) {
        console.log(`  ${badge("⏳ WAITING ON", "yellow")} (${inProgress.length} in-progress)`);
        divider("", 54);
        for (const t of inProgress) {
          // What would unblock when this completes?
          const wouldUnblock = allTasks.filter(other => {
            if (other.status !== "pending") return false;
            const deps = other.dependencies ? JSON.parse(other.dependencies) : [];
            return deps.includes(t.id);
          });
          console.log(`  →  #${String(t.id).padEnd(4)} ${t.name}${wouldUnblock.length ? `  (unblocks ${wouldUnblock.map(u => '#' + u.id).join(', ')})` : ""}`);
        }
      }
    }

    console.log(`\n  Legend: ${badge("✓", "green")} completed  ${badge("→", "blue")} in-progress  ${badge("○", "yellow")} pending  ${badge("·", "dim")} blocked  ${badge("!", "red")} escalated  ${badge("◎", "yellow")} review`);
    console.log("");
  },
};
