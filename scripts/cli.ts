#!/usr/bin/env bun
/**
 * PMM CLI Router — thin dispatch layer
 * ====================================
 * Schema init, command lookup, module dispatch.
 * All business logic lives in src/commands/*.ts
 *
 * Rust-translatable: this file becomes a CommandRegistry<dyn CommandHandler>.
 */
import { openDb } from "../src/db";
import { initSchema } from "../src/schema";

const db = openDb();
initSchema(db);

const cmd = process.argv[2];
const sub = process.argv[3];
const args = process.argv.slice(cmd === sub ? 3 : 4);

/** Map top-level command → module path (many-to-one allowed). */
const MODULE_MAP: Record<string, string> = {
  project:       "../src/commands/project",
  tool:          "../src/commands/project",
  milestone:     "../src/commands/planning",
  feature:       "../src/commands/planning",
  roadblock:     "../src/commands/planning",
  decision:      "../src/commands/planning",
  task:          "../src/commands/tasks",
  roadmap:       "../src/commands/portfolio",
  node:          "../src/commands/portfolio",
  product:       "../src/commands/portfolio",
  agent:         "../src/commands/agents",
  worker:        "../src/commands/agents",
  session:       "../src/commands/session",
  health:        "../src/commands/health",
  check:         "../src/commands/health",
  doctor:        "../src/commands/health",
  evaluator:     "../src/commands/evaluator",
  oracle:        "../src/commands/oracle",
  mem:           "../src/commands/mem",
  swarm:         "../src/commands/swarm",
  layer:         "../src/commands/swarm",
  exec:          "../src/commands/swarm",
  config:        "../src/commands/ops",
  summary:       "../src/commands/ops",
  standards:     "../src/commands/ops",
  deploy:        "../src/commands/ops",
  migrate:       "../src/commands/ops",
  process:       "../src/commands/ops",
  plan:          "../src/commands/ops",
  architect:     "../src/commands/ops",
  "protocol-align": "../src/commands/ops",
  wizard:        "../src/commands/wizard",
  view:          "../src/commands/view",
  dashboard:     "../src/commands/view",
  start:         "../src/commands/mvp-start",
  new:           "../src/commands/mvp-start",
  status:        "../src/commands/status",
  resume:        "../src/commands/status",
  mvp:           "../src/commands/mvp-scope",
  debate:        "../src/commands/debate",
  build:         "../src/commands/autonomous-build",
  watch:         "../src/commands/health-monitor",
  tooling:       "../src/commands/tooling-cmds",
};

async function main() {
  if (!cmd) {
    await printDashboard(db);
    db.close();
    return;
  }

  if (cmd === "help") {
    printTopLevelHelp();
    db.close();
    return;
  }

  const modulePath = MODULE_MAP[cmd];
  if (!modulePath) {
    console.log(`Unknown command: ${cmd}`);
    console.log("Run: bun scripts/cli.ts       (live dashboard)");
    console.log("     bun scripts/cli.ts help   (full command reference)");
    db.close();
    return;
  }

  const mod = await import(modulePath);
  const key = sub ? `${cmd}:${sub}` : cmd;
  const handler = mod.commands[key] ?? mod.commands[cmd];

  if (handler) {
    // If sub matched a specific key, pass just args. If it fell back to base key, prepend sub as positional arg.
    const argv = handler === mod.commands[key] ? args : [sub, ...args].filter(Boolean);
    await handler(db, argv);
  } else {
    if (sub) console.log(`Unknown subcommand: ${cmd} ${sub}`);
    const usageHandler = mod.commands[`${cmd}:help`];
    if (usageHandler) {
      await usageHandler(db, args);
    } else {
      printModuleUsage(cmd);
    }
  }

  db.close();
}

async function printDashboard(db: any) {
  const { queryAll, queryOne } = await import("../src/db");

  console.log("");
  console.log("\x1b[34m═══ PMM-AI — Centralized Nervous System ═══\x1b[0m  " + new Date().toLocaleString());
  console.log("");

  // ── Portfolio snapshot ──
  const projects = queryAll(db, "SELECT name, phase, priority, health FROM projects WHERE status = 'active' ORDER BY priority, name");
  if (projects.length) {
    console.log("  \x1b[34mPORTFOLIO\x1b[0m");
    console.log("  " + "─".repeat(54));
    for (const p of projects) {
      const icon = p.health === "healthy" ? "\x1b[32m✓\x1b[0m" : p.health === "attention" ? "\x1b[33m⚠\x1b[0m" : p.health === "blocked" ? "\x1b[31m✗\x1b[0m" : "○";
      console.log(`  ${icon}  ${String(p.name).padEnd(22)} ${String(p.phase).padEnd(10)} ${String(p.priority).padEnd(10)} ${p.health}`);
    }
    console.log("");
  }

  // ── Active session ──
  try {
    const fs = require("node:fs"); const path = require("node:path");
    const sp = path.join(import.meta.dir, "..", "state", "current-session.json");
    if (fs.existsSync(sp)) {
      const sess = JSON.parse(fs.readFileSync(sp, "utf8"));
      if (sess.project) {
        console.log("  \x1b[34mACTIVE SESSION\x1b[0m");
        console.log("  " + "─".repeat(54));
        console.log(`  ${sess.harness || "?"} / ${sess.model || "?"} / ${sess.project}`);
        console.log("");
      }
    }
  } catch {}

  // ── Planning state ──
  const openDecisions = (queryOne(db, "SELECT COUNT(*) as c FROM decisions WHERE status = 'open'") as any).c;
  const activeRoadblocks = (queryOne(db, "SELECT COUNT(*) as c FROM roadblocks WHERE resolved_at IS NULL") as any).c;
  const pendingMilestones = (queryOne(db, "SELECT COUNT(*) as c FROM milestones WHERE status = 'pending'") as any).c;

  if (openDecisions > 0 || activeRoadblocks > 0 || pendingMilestones > 0) {
    console.log("  \x1b[34mPLANNING STATE\x1b[0m");
    console.log("  " + "─".repeat(54));
    if (openDecisions > 0) console.log(`  \x1b[33m○\x1b[0m  ${openDecisions} open decision${openDecisions !== 1 ? "s" : ""}`);
    if (activeRoadblocks > 0) console.log(`  \x1b[31m⚠\x1b[0m  ${activeRoadblocks} active roadblock${activeRoadblocks !== 1 ? "s" : ""}`);
    if (pendingMilestones > 0) console.log(`  \x1b[33m○\x1b[0m  ${pendingMilestones} pending milestone${pendingMilestones !== 1 ? "s" : ""}`);
    console.log("");
  }

  // ── Quick actions ──
  console.log("  \x1b[34mQUICK ACTIONS\x1b[0m");
  console.log("  " + "─".repeat(54));
  console.log("  \x1b[32mstart new\x1b[0m  bun scripts/cli.ts start new         Create a new project (auto-plan)");
  console.log("  \x1b[32mstart\x1b[0m      bun scripts/cli.ts start              Portfolio + live dashboard");
  console.log("  \x1b[32mview\x1b[0m       bun scripts/cli.ts view <project>     Project dashboard");
  console.log("  \x1b[32mhealth\x1b[0m     bun scripts/cli.ts health              Portfolio health check");
  console.log("");

  // ── Full command reference ──
  console.log("  \x1b[2mFull command reference: bun scripts/cli.ts help\x1b[0m");
  console.log("");
}

function printTopLevelHelp() {
  console.log("PMM-AI — Autonomous Development Platform");
  console.log("");
  console.log("Usage: bun scripts/cli.ts <command> [subcommand] [args]");
  console.log("");
  console.log("─── MVP Commands (start here!) ───");
  console.log("  start     [new|<project>]         Portfolio, create projects, view dashboards");
  console.log("  new       (alias for start new)    Guided project creation wizard");
  console.log("  view      <project>               Generate HTML project dashboard");
  console.log("  health    [triage]                Portfolio health check");
  console.log("");
  console.log("─── Project Management ───");
  console.log("  project   <register|onboard|discover|list|get|update|delete>");
  console.log("  milestone <add|list|update|complete>");
  console.log("  feature   <add|list|update|complete>");
  console.log("  roadblock <add|list|resolve>");
  console.log("  decision  <add|list|decide|review>");
  console.log("  task      <add|list|update|complete|log>");
  console.log("");
  console.log("─── Agent & Swarm (auto-configured by start new) ───");
  console.log("  worker    <dispatch|update|list|trace|schedule>");
  console.log("  swarm     <deploy|visualize|status|export>");
  console.log("  layer     <list|update>");
  console.log("  session   <register|close|list|get|name>");
  console.log("");
  console.log("─── Advanced ───");
  console.log("  wizard    <project|milestone|decision|swarm>   Interactive workflows");
  console.log("");
  console.log("Visibility & Triage:");
  console.log("  health    triage                               Priority-ordered action list");
  console.log("  decision  review <project>                     Open questions surface");
  console.log("  swarm     visualize <project>                  Dependency graph view");
  console.log("");
  console.log("Project Management:");
  console.log("  project   <register|onboard|discover|list|get|update|delete>  Manage projects");
  console.log("  milestone <add|add-batch|list|update|complete> Manage milestones");
  console.log("  feature   <add|add-batch|list|update|complete> Manage features");
  console.log("  roadblock <add|add-batch|list|resolve>         Manage roadblocks");
  console.log("  decision  <add|add-batch|list|decide|review>   Manage decisions");
  console.log("  task      <add|add-batch|list|update|complete|log>  Manage tasks");
  console.log("");
  console.log("Portfolio & Hierarchy:");
  console.log("  roadmap   <create|list|get|tree|update|...>    Manage roadmaps");
  console.log("  node      <list|get|tree|create|update|delete> Portfolio hierarchy");
  console.log("  product   <list|tree>                          Product hierarchy");
  console.log("");
  console.log("Agent & Swarm:");
  console.log("  session   <start|register|close|list|get|name> Manage sessions");
  console.log("  worker    <dispatch|update|list|trace|schedule> Manage workers");
  console.log("  swarm     <init|pool|task|checkout|checkin|visualize|deploy|...>  Multi-agent");
  console.log("  layer     <define|list|update>                 Swarm layers");
  console.log("  exec      <harnesses|onboard-harness|inject>   Execution framework");
  console.log("");
  console.log("Health & Intelligence:");
  console.log("  health    [triage]                              Health check");
  console.log("  check     [--full] [--quick]                    Cross-pillar pipeline");
  console.log("  doctor    <check|diagnose|heal|history|policy>  Diagnostics");
  console.log("  evaluator <define|list|run|watch|...>           Quality gates");
  console.log("  oracle    <observe|research|brief|ask|...>      Intelligence");
  console.log("");
  console.log("Operations:");
  console.log("  summary                                        Quick overview");
  console.log("  config    <set|get|list>                        Automation config");
  console.log("  standards <list|add|generate|check|check-all>   Standards");
  console.log("  plan      <project> --preset <tier>             Planning");
  console.log("  architect review <project> [--intensity ...]    Architecture review");
  console.log("  tool      <add|list>                            Manage tools");
  console.log("  agent     <list|force-register|unforce|policy>  Manage agents");
  console.log("  mem       <search|recent|context|...>           Memory bridge");
  console.log("  build     <list>                                Build history");
  console.log("  deploy    <list>                                Deploy history");
  console.log("  migrate   <status>                              Schema versions");
  console.log("  process   <scan|bridge|register>                Process awareness");
  console.log("  protocol-align <project> [--protocol <p>]       Protocol alignment");
}

function printModuleUsage(cmd: string) {
  console.log(`Run: bun scripts/cli.ts ${cmd}  or  bun scripts/cli.ts (no args) for full help`);
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  try { db.close(); } catch {}
  process.exit(1);
});
