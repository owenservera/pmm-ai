/**
 * PMM Operations Commands
 * =======================
 * config + summary + standards + build + deploy + migrate + process + plan + architect + protocol-align
 * Catch-all for smaller, read-only, or delegation-based commands.
 */
import type { Database } from "bun:sqlite";
import { getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ config ══════════════════════════════════════════
  "config:set": async (db, args) => {
    requireArgs(2, '<key> <value> [--project <name>] [--desc "..."]', "config", "set", args);
    const key = args[0]!; const value = args[1]!;
    let projectName = "TERMINAL", desc: string | null = null;
    for (let i = 2; i < args.length; i++) { if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!; else if (args[i] === "--desc" && args[i + 1]) desc = args[++i]!; }
    const pid = getProjectIdOrFail(db, projectName);
    run(db, `INSERT OR REPLACE INTO automation_configs (project_id, key, value, description, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`, [pid, key, value, desc]);
    console.log(`Config set: ${key} = ${value} (${projectName})`);
  },

  "config:get": async (db, args) => {
    requireArgs(1, "<key> [--project <name>]", "config", "get", args);
    const key = args[0]!;
    let projectName = "TERMINAL";
    for (let i = 1; i < args.length; i++) { if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!; }
    const pid = getProjectIdOrFail(db, projectName);
    const row = queryOne(db, "SELECT key, value, description, updated_at FROM automation_configs WHERE project_id = ? AND key = ?", [pid, key]) as any;
    if (!row) { console.log(`Config key "${key}" not found for ${projectName}`); return; }
    console.log(`${row.key} = ${row.value} (${row.description || "no description"}) · updated ${row.updated_at}`);
  },

  "config:list": async (db, args) => {
    const projectName = args[0] || null;
    let pid: number | null = null;
    if (projectName) pid = getProjectIdOrFail(db, projectName);
    const sql = pid ? "SELECT key, value, description FROM automation_configs WHERE project_id = ? ORDER BY key" : "SELECT p.name as project, c.key, c.value FROM automation_configs c JOIN projects p ON c.project_id = p.id ORDER BY p.name, c.key";
    const rows = pid ? queryAll(db, sql, [pid]) : queryAll(db, sql);
    if (!rows.length) { console.log("No config entries found"); return; }
    if (pid) { table(["Key", "Value", "Description"], rows.map((r: any) => [r.key, r.value, r.description || "—"])); }
    else { table(["Project", "Key", "Value"], rows.map((r: any) => [r.project, r.key, r.value])); }
  },

  // ═══ summary ═════════════════════════════════════════
  "summary": async (db, _args) => {
    const counts = {
      projects: (queryOne(db, "SELECT COUNT(*) as c FROM projects") as any).c,
      roadmaps: (queryOne(db, "SELECT COUNT(*) as c FROM portfolio_nodes WHERE parent_id IS NULL") as any).c,
      nodes: (queryOne(db, "SELECT COUNT(*) as c FROM portfolio_nodes") as any).c,
      tools: (queryOne(db, "SELECT COUNT(*) as c FROM tooling") as any).c,
      subagents: (queryOne(db, "SELECT COUNT(*) as c FROM subagents") as any).c,
      workers: (queryOne(db, "SELECT COUNT(*) as c FROM agent_workers") as any).c,
      mcp: (queryOne(db, "SELECT COUNT(*) as c FROM mcp_servers") as any).c,
      pipelines: (queryOne(db, "SELECT COUNT(*) as c FROM pipelines") as any).c,
      hooks: (queryOne(db, "SELECT COUNT(*) as c FROM hooks") as any).c,
      skills: (queryOne(db, "SELECT COUNT(*) as c FROM skills") as any).c,
      captures: (queryOne(db, "SELECT COUNT(*) as c FROM protocol_captures WHERE status='captured'") as any).c,
      capturesTotal: (queryOne(db, "SELECT COUNT(*) as c FROM protocol_captures") as any).c,
    };
    console.log("\n=== PMM Summary ===\n");
    console.log(`  Projects:   ${counts.projects}`);
    console.log(`  Roadmaps:   ${counts.roadmaps} (${counts.nodes} total nodes)`);
    console.log(`  Tools:      ${counts.tools}`);
    console.log(`  Subagents:  ${counts.subagents}`);
    console.log(`  Workers:    ${counts.workers}`);
    console.log(`  MCP:        ${counts.mcp} servers`);
    console.log(`  Pipelines:  ${counts.pipelines}`);
    console.log(`  Hooks:      ${counts.hooks}`);
    console.log(`  Skills:     ${counts.skills}`);
    console.log(`  Captures:   ${counts.captures}/${counts.capturesTotal}`);
  },

  // ═══ standards ═══════════════════════════════════════
  "standards:list": async (db, args) => {
    let filter = "WHERE 1=1"; const params: any[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--category" && args[i + 1]) { filter += " AND category = ?"; params.push(args[++i]!); }
      else if (args[i] === "--severity" && args[i + 1]) { filter += " AND severity = ?"; params.push(args[++i]!); }
    }
    const rows = queryAll(db, `SELECT rule_key, category, severity, title, check_type, auto_fix FROM standards ${filter} ORDER BY category, severity, rule_key`, params);
    if (!rows.length) { console.log("No standards found"); return; }
    table(["Rule", "Category", "Sev", "Title", "Check", "Auto"], rows.map((r: any) => [r.rule_key, r.category, r.severity, r.title, r.check_type, r.auto_fix ? "✓" : ""]));
  },

  "standards:add": async (db, args) => {
    requireArgs(2, '<rule_key> --category <cat> --severity <P0|P1|P2> --title "..." [--check-type file_exists] [--target "..."] [--expected "..."] [--project-types "*"] [--auto-fix]', "standards", "add", args);
    const ruleKey = args[0]!; const desc = args[1]!;
    let category = "", severity = "P2", title = "", checkType = "file_exists", target = "", expected: string | null = null, projectTypes = "*", autoFix = 0;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--category" && args[i + 1]) category = args[++i]!;
      else if (args[i] === "--severity" && args[i + 1]) severity = args[++i]!;
      else if (args[i] === "--title" && args[i + 1]) title = args[++i]!;
      else if (args[i] === "--check-type" && args[i + 1]) checkType = args[++i]!;
      else if (args[i] === "--target" && args[i + 1]) target = args[++i]!;
      else if (args[i] === "--expected" && args[i + 1]) expected = args[++i]!;
      else if (args[i] === "--project-types" && args[i + 1]) projectTypes = args[++i]!;
      else if (args[i] === "--auto-fix") autoFix = 1;
    }
    if (!category || !title) { console.log("--category and --title are required"); return; }
    run(db, `INSERT OR REPLACE INTO standards (category, rule_key, title, description, severity, check_type, target, expected, project_types, auto_fix) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [category, ruleKey, title, desc, severity, checkType, target, expected, projectTypes, autoFix]);
    console.log(`Registered standard: ${ruleKey} (${category}/${severity})`);
  },

  "standards:generate": async (db, _args) => {
    const rows = queryAll(db, "SELECT * FROM standards ORDER BY category, severity, rule_key") as any[];
    const cats = ["code", "architecture", "docs", "testing"];
    const severityOrder = ["P0", "P1", "P2"];
    let md = "# Project Standards Constitution\n\n> Generated from PMM standards registry.\n> Last synced: " + new Date().toISOString().slice(0, 10) + ". Active standards: " + rows.length + "\n\n";
    for (const cat of cats) {
      const catRows = rows.filter((r) => r.category === cat);
      if (!catRows.length) continue;
      md += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)} Standards (${catRows.length} rules)\n\n`;
      for (const sev of severityOrder) {
        const sevRows = catRows.filter((r) => r.severity === sev);
        if (!sevRows.length) continue;
        md += "| Rule | Description | Check |\n|------|-------------|-------|\n";
        for (const r of sevRows) { md += `| \`${r.rule_key}\` | ${r.description} | ${r.check_type === "file_exists" ? `\`${r.target}\` exists` : r.check_type === "config_key" ? `\`${r.target}\` = \`${r.expected || "any"}\`` : `\`${r.check_type}\`: \`${r.target}\``} |\n`; }
        md += "\n";
      }
    }
    const activeProjects = queryAll(db, "SELECT id, name FROM projects WHERE status = 'active' ORDER BY name") as any[];
    if (activeProjects.length) {
      md += "## Compliance Matrix\n\n| Project | Code | Architecture | Docs | Testing | Score |\n|---------|------|-------------|------|---------|-------|\n";
      for (const p of activeProjects) {
        const totals: Record<string, number> = { code: 0, architecture: 0, docs: 0, testing: 0 };
        for (const cat of cats) { totals[cat] = (queryOne(db, "SELECT COUNT(*) as c FROM compliance_runs WHERE project_id = ? AND standard_id IN (SELECT id FROM standards WHERE category = ?) AND passed = 1", [p.id, cat]) as any).c; }
        const total = Object.values(totals).reduce((a, b) => a + b, 0);
        const pct = rows.length ? Math.round((total / rows.length) * 100) : 0;
        md += `| ${p.name} | ${totals.code}/— | ${totals.architecture}/— | ${totals.docs}/— | ${totals.testing}/— | ${pct}% |\n`;
      }
    }
    const fs = require("node:fs"); const path = require("node:path");
    const root = path.join(import.meta.dir, "..", "..");
    fs.writeFileSync(path.join(root, "STANDARDS.md"), md);
    console.log(`Generated STANDARDS.md (${rows.length} standards)`);
  },

  "standards:check": async (db, args) => {
    requireArgs(1, "<project-name> [--gated] [--strict]", "standards", "check", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    let enforcement = "advisory";
    for (let i = 1; i < args.length; i++) { if (args[i] === "--gated") enforcement = "gated"; else if (args[i] === "--strict") enforcement = "strict"; }
    const project = queryOne(db, "SELECT tech_stack FROM projects WHERE id = ?", [pid]) as any;
    const techStack: string[] = project?.tech_stack ? JSON.parse(project.tech_stack) : [];
    const projectType = techStack.length > 0 ? techStack[0] : "typescript";
    const standards = queryAll(db, `SELECT * FROM standards WHERE project_types = '*' OR project_types LIKE ? ORDER BY severity, category`, [`%${projectType}%`]) as any[];
    console.log(`\n=== Standards Check: ${projectName} (${enforcement}) ===\n`);
    let passed = 0, failed = 0;
    const results: { rule_key: string; passed: boolean; detail: string }[] = [];
    for (const s of standards) {
      const fs = require("node:fs"); const path = require("node:path"); const root = process.cwd();
      let pass = false; let detail = "";
      if (s.check_type === "file_exists") { pass = fs.existsSync(path.join(root, s.target)); detail = pass ? `Found: ${s.target}` : `Missing: ${s.target}`; }
      else if (s.check_type === "config_key") {
        const parts = s.target.split("."); let filename = ""; let keyPath: string[] = []; let filePath = "";
        for (let i = 0; i < parts.length; i++) { filename = parts.slice(0, i + 1).join("."); filePath = path.join(root, filename); if (fs.existsSync(filePath)) { keyPath = parts.slice(i + 1); break; } }
        if (!fs.existsSync(filePath)) { pass = false; detail = `Config file not found: ${filename}`; }
        else { try { const content = JSON.parse(fs.readFileSync(filePath, "utf-8")); let value = content; for (const k of keyPath) value = value?.[k]; if (s.expected === "*") { pass = value !== undefined && value !== null && value !== ""; } else if (s.expected?.startsWith("≥")) { pass = typeof value === "number" && value >= parseInt(s.expected.slice(1)); } else { pass = String(value) === s.expected; } detail = pass ? `${s.target} = ${JSON.stringify(value)} (expected: ${s.expected || "present"})` : `${s.target} = ${JSON.stringify(value)} (expected: ${s.expected})`; } catch { pass = false; detail = `Could not parse ${filename}`; } }
      } else if (s.check_type === "pattern") { const glob = s.target; const dir = path.dirname(glob); const ext = path.extname(glob); const fullDir = path.join(root, dir); if (!fs.existsSync(fullDir)) { pass = false; detail = `Directory not found: ${dir}`; } else { const files = fs.readdirSync(fullDir).filter((f: string) => f.endsWith(ext)); if (s.expected?.startsWith("≥")) { pass = files.length >= parseInt(s.expected.slice(1)); } else { pass = files.length > 0; } detail = pass ? `Found ${files.length} file(s) matching ${glob}` : `No files matching ${glob}`; } }
      else if (s.check_type === "regex") { const glob = s.target; const pattern = new RegExp(s.expected || ".*"); const { execSync } = require("node:child_process"); try { const result = execSync(`grep -rE "${s.expected || ".*"}" ${JSON.stringify(path.join(root, path.dirname(glob)))} --include="${path.basename(glob)}" 2>/dev/null || true`, { encoding: "utf-8", cwd: root }); pass = result.trim().length > 0; detail = pass ? `Pattern "${s.expected}" matched in ${s.target}` : `Pattern "${s.expected}" not found in ${s.target}`; } catch { pass = false; detail = `Could not search ${s.target}`; } }
      if (pass) passed++; else failed++;
      results.push({ rule_key: s.rule_key, passed: pass, detail });
      console.log(`  ${pass ? "✓" : "✗"} ${s.rule_key} [${s.severity}] ${detail}`);
      run(db, `INSERT INTO compliance_runs (project_id, standard_id, passed, detail) VALUES (?, ?, ?, ?)`, [pid, s.id, pass ? 1 : 0, detail]);
    }
    console.log(`\n  Passed: ${passed} | Failed: ${failed} | Total: ${standards.length}`);
    console.log(`  Score: ${Math.round((passed / standards.length) * 100)}%\n`);
    if (enforcement === "gated" || enforcement === "strict") {
      const p0Failed = results.filter((r) => { const s = standards.find((x: any) => x.rule_key === r.rule_key); return !r.passed && s?.severity === "P0"; });
      const p1Failed = results.filter((r) => { const s = standards.find((x: any) => x.rule_key === r.rule_key); return !r.passed && s?.severity === "P1"; });
      if (p0Failed.length) console.log(`BLOCKED: ${p0Failed.length} P0 violation(s)`);
      if (enforcement === "strict" && p1Failed.length) console.log(`BLOCKED: ${p1Failed.length} P1 violation(s) (strict mode)`);
    }
  },

  "standards:check-all": async (db, args) => {
    const projects = queryAll(db, "SELECT name FROM projects WHERE status = 'active'") as any[];
    const { execSync } = require("node:child_process");
    for (const p of projects) { try { execSync(`bun scripts/pmm.ts standards check ${JSON.stringify(p.name)} ${args.join(" ")}`, { stdio: "inherit", cwd: process.cwd() }); } catch (err: any) { console.error(`  ERROR checking ${p.name}: ${err.message || err}`); } }
    console.log("\nAll projects checked.");
  },

  // ═══ build ═══════════════════════════════════════════
  "build:list": async (db, args) => {
    let filter = ""; const params: any[] = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) { filter += " AND p.name = ?"; params.push(args[++i]!); }
      else if (args[i] === "--status" && args[i + 1]) { filter += " AND br.status = ?"; params.push(args[++i]!); }
    }
    const rows = queryAll(db, `SELECT br.id, p.name AS project, br.status, br.command, br.duration_ms, br.commit_sha, br.started_at FROM build_runs br JOIN projects p ON br.project_id = p.id WHERE 1=1 ${filter} ORDER BY br.started_at DESC LIMIT 20`, params);
    if (!rows.length) { console.log("No build runs recorded yet. Build tracking is now active."); return; }
    table(["ID", "Project", "Status", "Duration", "Commit", "Started"], rows.map((r: any) => [String(r.id), r.project, r.status, r.duration_ms ? `${r.duration_ms}ms` : "—", r.commit_sha ? String(r.commit_sha).slice(0, 7) : "—", r.started_at ? String(r.started_at).slice(0, 16) : "—"]));
  },

  // ═══ deploy ══════════════════════════════════════════
  "deploy:list": async (db, args) => {
    let filter = ""; const params: any[] = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) { filter += " AND p.name = ?"; params.push(args[++i]!); }
      else if (args[i] === "--env" && args[i + 1]) { filter += " AND dr.environment = ?"; params.push(args[++i]!); }
      else if (args[i] === "--status" && args[i + 1]) { filter += " AND dr.status = ?"; params.push(args[++i]!); }
    }
    const rows = queryAll(db, `SELECT dr.id, p.name AS project, dr.environment, dr.status, dr.provider, dr.url, dr.duration_ms, dr.started_at FROM deploy_runs dr JOIN projects p ON dr.project_id = p.id WHERE 1=1 ${filter} ORDER BY dr.started_at DESC LIMIT 20`, params);
    if (!rows.length) { console.log("No deploy runs recorded yet. Deploy tracking is now active."); return; }
    table(["ID", "Project", "Env", "Status", "Provider", "URL", "Started"], rows.map((r: any) => [String(r.id), r.project, r.environment, r.status, r.provider || "—", r.url || "—", r.started_at ? String(r.started_at).slice(0, 16) : "—"]));
  },

  // ═══ migrate ═════════════════════════════════════════
  "migrate:status": async (db, _args) => {
    const rows = queryAll(db, "SELECT version, description, filename, applied_at FROM schema_versions ORDER BY version");
    if (!rows.length) { console.log("No migration records found."); return; }
    console.log("Schema Migration History:\n");
    for (const r of rows) { console.log(`  v${(r as any).version}  ${(r as any).description}`); console.log(`         ${(r as any).filename}  |  ${(r as any).applied_at}`); }
  },

  // ═══ process ═════════════════════════════════════════
  "process:scan": async (db, _args) => {
    const { processScan } = await import("../process/scan");
    const result = processScan();
    console.log("=== Process State ===\n");
    console.log(`  Phase:      ${result.detected_phase}`);
    console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    console.log(`  Harness:    ${result.environment.harness}`);
    console.log(`  Methods:    ${result.environment.active_methodologies.join(", ") || "none"}`);
    if (result.gaps.length) { console.log(`\n  Gaps (${result.gaps.length}):`); for (const g of result.gaps) { console.log(`    ${g.auto_fixable ? "[auto-fixable]" : "[needs input]"} ${g.type}: ${g.description}`); if (g.source_artifact) console.log(`      source: ${g.source_artifact}`); } }
  },

  "process:bridge": async (db, args) => {
    requireArgs(1, "<path>", "process", "bridge", args);
    const artifactPath = args[0]!;
    const { processScan } = await import("../process/scan");
    const { bridgeArtifact } = await import("../process/bridge");
    const scan = processScan();
    const artifact = scan.artifacts.find((a) => a.path === artifactPath);
    if (!artifact) { console.log(`Artifact "${artifactPath}" not found in scan. Available artifacts:`); for (const a of scan.artifacts.slice(0, 10)) console.log(`  ${a.path}`); return; }
    const { openDb, queryOne } = await import("../db");
    const db2 = openDb();
    const method = queryOne(db2, "SELECT * FROM methodologies WHERE name = ?", [artifact.methodology]) as any;
    db2.close();
    if (!method) { console.log(`Methodology "${artifact.methodology}" not found`); return; }
    const mRecord = { id: method.id, name: method.name, description: method.description, detection_signals: JSON.parse(method.detection_signals), artifact_mappings: JSON.parse(method.artifact_mappings), phase_rules: method.phase_rules ? JSON.parse(method.phase_rules) : null, priority: method.priority, enabled: method.enabled };
    const extracted = bridgeArtifact(artifactPath, mRecord);
    console.log(JSON.stringify(extracted, null, 2));
  },

  "process:register": async (db, args) => {
    requireArgs(1, "<path>", "process", "register", args);
    const artifactPath = args[0]!;
    const { processScan } = await import("../process/scan");
    const { bridgeArtifact, bridgeToPMM } = await import("../process/bridge");
    const scan = processScan();
    const artifact = scan.artifacts.find((a) => a.path === artifactPath);
    if (!artifact) { console.log(`Artifact not found: ${artifactPath}`); return; }
    const { openDb, queryOne } = await import("../db");
    const db2 = openDb();
    const method = queryOne(db2, "SELECT * FROM methodologies WHERE name = ?", [artifact.methodology]) as any;
    db2.close();
    const mRecord = { id: method.id, name: method.name, description: method.description, detection_signals: JSON.parse(method.detection_signals), artifact_mappings: JSON.parse(method.artifact_mappings), phase_rules: method.phase_rules ? JSON.parse(method.phase_rules) : null, priority: method.priority, enabled: method.enabled };
    const extracted = bridgeArtifact(artifactPath, mRecord);
    console.log(`Extracted from ${extracted.artifact_type} (${(extracted.extraction_confidence * 100).toFixed(0)}% confidence):`);
    if (extracted.project) console.log(`  Project: ${extracted.project.name} [${extracted.project.phase}] (${extracted.project.tech_stack.join(", ")})`);
    console.log(`  Milestones: ${extracted.milestones.length}`); console.log(`  Features: ${extracted.features.length}`); console.log(`  Decisions: ${extracted.decisions.length}`);
    if (extracted.warnings.length) for (const w of extracted.warnings) console.log(`  ⚠ ${w}`);
    const registered = bridgeToPMM(extracted);
    console.log(`\nRegistered:`); console.log(`  Project: ${registered.project_name} (#${registered.project_id})`); console.log(`  Milestones: ${registered.milestones_registered}`); console.log(`  Features: ${registered.features_registered}`); console.log(`  Decisions: ${registered.decisions_registered}`);
    if (registered.errors.length) for (const e of registered.errors) console.log(`  ✗ ${e}`);
  },

  // ═══ plan ════════════════════════════════════════════
  "plan": async (db, args) => {
    let projectName = ""; let preset = "";
    // Accepts: plan <project> --preset <tier> OR plan --preset <tier>
    const validPresets = ["quick", "standard", "deep", "full", "complete"];
    for (let i = 0; i < args.length; i++) { if (args[i] === "--preset" && args[i + 1]) preset = args[++i]!; }
    if (!preset) { console.log("Usage: bun scripts/pmm.ts plan <project> --preset quick|standard|deep|full|complete"); console.log("Phase-aware presets:"); console.log("  quick     ~1K tokens"); console.log("  standard  ~5K tokens (1 agent)"); console.log("  deep      ~10K tokens (2 agents)"); console.log("  full      ~18K tokens (2 agents)"); console.log("  complete  ~35K tokens (3 agents)"); return; }
    if (!validPresets.includes(preset)) { console.log(`Invalid preset: ${preset}`); return; }
    // Project from args or current-session.json
    if (args[0] && args[0] !== "--preset" && !["quick", "standard", "deep", "full", "complete"].includes(args[0])) projectName = args[0];
    if (!projectName) {
      try { const fs = require("node:fs"); const path = require("node:path"); const sp = path.join(import.meta.dir, "..", "..", "state", "current-session.json"); if (fs.existsSync(sp)) { const prev = JSON.parse(fs.readFileSync(sp, "utf8")); projectName = prev.project || ""; } } catch {}
    }
    if (!projectName) { console.log("No project specified. Use '/pmm-plan' for interactive mode."); return; }
    const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [projectName]) as any;
    if (!project) { console.log(`Project "${projectName}" not registered.`); return; }
    console.log(`=== PMM Plan: ${projectName} [${preset}] ===`);
    console.log(`  Phase:     ${project.phase}`); console.log(`  Stack:     ${project.tech_stack || "none"}`); console.log(`  Path:      ${project.repo_path || "none"}`);
    console.log(""); console.log("To execute, run:");
    console.log(`  Task(subagent_type="pmm-planner", model="sonnet", prompt="Plan ${projectName} at ${preset} preset. Write PMM/${projectName}/project.md")`);
  },

  // ═══ architect ═══════════════════════════════════════
  "architect:review": async (db, args) => {
    requireArgs(1, "<project> [--intensity low|medium|high]", "architect", "review", args);
    const projectName = args[0]!;
    let intensity = "low";
    for (let i = 1; i < args.length; i++) { if (args[i] === "--intensity" && args[i + 1]) { intensity = args[++i]!; if (!["low", "medium", "high"].includes(intensity)) { console.log("Intensity must be: low, medium, or high"); return; } } }
    const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [projectName]) as any;
    if (!project) { console.log(`Project "${projectName}" not registered.`); return; }
    const tokenEst: Record<string, string> = { low: "~2K tokens", medium: "~8K tokens", high: "~20K tokens" };
    console.log(`=== Architect Review: ${projectName} ===`);
    console.log(`  Intensity:  ${intensity} (${tokenEst[intensity] || "?"})`);
    console.log(`  Phase:      ${project.phase}`); console.log(`  Path:       ${project.repo_path || "none"}`);
    console.log("");
    if (intensity === "low") {
      const fs = require("node:fs"); const path = require("node:path"); const repoPath = project.repo_path;
      if (!repoPath || !fs.existsSync(repoPath)) { console.log("No repo path or path not accessible — skipping structural check."); return; }
      const absPath = path.resolve(repoPath); console.log("Quick structural scan:");
      const smells: string[] = [];
      try {
        const entries = fs.readdirSync(absPath, { recursive: true }).filter((f: string) => /\.(ts|tsx|js|jsx|py|go|rs)$/.test(f) && !f.includes("node_modules"));
        for (const entry of entries.slice(0, 200)) { try { const full = path.join(absPath, entry); const stat = fs.statSync(full); if (stat.size > 50000) smells.push(`Large file: ${entry} (${(stat.size / 1024).toFixed(0)}KB)`); } catch (_) {} }
        for (const d of ["src", "docs", "tests"]) { if (!fs.existsSync(path.join(absPath, d))) smells.push(`Missing directory: ${d}/`); }
      } catch (_) {}
      if (smells.length) { console.log("  Structural smells:"); for (const s of smells) console.log(`    ⚠ ${s}`); } else { console.log("  No obvious structural smells detected."); }
      console.log(`\nFor deeper analysis, run: bun scripts/pmm.ts architect review ${projectName} --intensity medium`);
    } else {
      console.log("To execute, spawn the pmm-architect agent:"); console.log("");
      console.log(`  WORKER_ID=$(bun scripts/pmm.ts worker dispatch pmm-architect sonnet \\`);
      console.log(`    "Architecture review for ${projectName} at intensity ${intensity}" \\`);
      console.log(`    --project ${projectName})`);
    }
  },

  // ═══ protocol-align ══════════════════════════════════
  "protocol-align": async (db, args) => {
    const projectName = args[0];
    if (!projectName) { console.log("Usage: bun scripts/pmm.ts protocol-align <project-name> [--protocol socket.io|rest|websocket]"); return; }
    let protocol = "socket.io";
    for (let i = 0; i < args.length; i++) { if (args[i] === "--protocol" && args[i + 1]) protocol = args[++i]!; }
    const project = queryOne(db, "SELECT repo_path FROM projects WHERE name = ?", [projectName]) as any;
    if (!project) { console.log(`Project "${projectName}" not found in PMM DB.`); return; }
    const projectPath = project.repo_path;
    if (!projectPath) { console.log(`Project "${projectName}" has no repo_path set.`); return; }
    const fs = require("node:fs");
    if (!fs.existsSync(projectPath)) { console.log(`Project path does not exist: ${projectPath}`); return; }
    const scanner = require("../protocol-align");
    const { loadProtocolConfig, autoDetectProtocol, scanProtocolAlignment, formatScanReport } = scanner;
    let config;
    if (protocol === "auto") { const detected = autoDetectProtocol(projectPath); if (!detected) { console.log("Could not auto-detect protocol. Specify one with --protocol."); return; } protocol = detected; config = loadProtocolConfig(protocol); }
    else { config = loadProtocolConfig(protocol); }
    if (!config) { console.log(`Protocol config not found: ${protocol}`); console.log("Available built-in configs: socket.io, rest, websocket"); return; }
    console.log(`Scanning ${projectName} (${protocol}) at ${projectPath}...\n`);
    const result = scanProtocolAlignment(projectPath, config);
    console.log(formatScanReport(result));
  },
};
