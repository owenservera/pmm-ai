/**
 * Dead Module Detector — Tree Shaking for PMM-AI
 * ==============================================
 * Detects unused code: commands in MODULE_MAP that don't resolve,
 * skills without matching agents, MCP tools without implementations,
 * orphaned imports, and modules never imported.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { queryAll, queryOne } from "../db";

const ROOT = join(import.meta.dir, "..", "..");

export interface DeadCodeReport {
  unresolved_commands: string[];
  orphan_skills: string[];
  orphan_agents: string[];
  unused_mcp_tools: string[];
  dead_modules: string[];
  total_dead: number;
}

/** Run full dead-code analysis against PMM-AI itself. */
export function analyze(db: Database): DeadCodeReport {
  const report: DeadCodeReport = {
    unresolved_commands: [],
    orphan_skills: [],
    orphan_agents: [],
    unused_mcp_tools: [],
    dead_modules: [],
    total_dead: 0,
  };

  // 1. Unresolved commands: MODULE_MAP entries pointing to nonexistent files
  const MODULE_MAP = {
    project: "../src/commands/project", tool: "../src/commands/project",
    milestone: "../src/commands/planning", feature: "../src/commands/planning",
    roadblock: "../src/commands/planning", decision: "../src/commands/planning",
    task: "../src/commands/tasks",
    roadmap: "../src/commands/portfolio", node: "../src/commands/portfolio", product: "../src/commands/portfolio",
    agent: "../src/commands/agents", worker: "../src/commands/agents",
    session: "../src/commands/session",
    health: "../src/commands/health", check: "../src/commands/health", doctor: "../src/commands/health",
    evaluator: "../src/commands/evaluator",
    oracle: "../src/commands/oracle",
    mem: "../src/commands/mem",
    swarm: "../src/commands/swarm", layer: "../src/commands/swarm", exec: "../src/commands/swarm",
    config: "../src/commands/ops", summary: "../src/commands/ops", standards: "../src/commands/ops",
    build: "../src/commands/ops", deploy: "../src/commands/ops", migrate: "../src/commands/ops",
    process: "../src/commands/ops", plan: "../src/commands/ops", architect: "../src/commands/ops",
    "protocol-align": "../src/commands/ops",
    wizard: "../src/commands/wizard",
    view: "../src/commands/view", dashboard: "../src/commands/view",
    start: "../src/commands/mvp-start", new: "../src/commands/mvp-start",
  };

  const moduleFiles = new Set<string>();
  for (const [cmd, modPath] of Object.entries(MODULE_MAP)) {
    const fullPath = join(ROOT, modPath + ".ts");
    if (!existsSync(fullPath)) {
      report.unresolved_commands.push(`${cmd} → ${modPath}.ts (missing)`);
    } else {
      moduleFiles.add(modPath);
    }
  }

  // 2. Orphan skills: skills in DB with no matching agent definition file
  const skills = queryAll(db, "SELECT name FROM skills ORDER BY name") as any[];
  const agents = queryAll(db, "SELECT name FROM subagents WHERE trackable = 1 ORDER BY name") as any[];
  const agentFiles = new Set<string>();

  const agentsDir = join(import.meta.dir, "..", "..", "..", ".claude", "agents");
  if (existsSync(agentsDir)) {
    try {
      for (const entry of require("fs").readdirSync(agentsDir)) {
        if (entry.endsWith(".md")) agentFiles.add(entry.replace(".md", ""));
      }
    } catch {}
  }

  for (const s of skills) {
    if (!agentFiles.has(s.name) && !agentFiles.has(s.name.replace("pmm-", "pmm-"))) {
      // Check for matching agent in files
      let found = false;
      for (const af of agentFiles) {
        if (af === s.name || s.name.includes(af) || af.includes(s.name)) { found = true; break; }
      }
      if (!found) report.orphan_skills.push(s.name);
    }
  }

  // 3. Orphan agents: agent .md files not registered in PMM DB
  for (const af of agentFiles) {
    const registered = skills.some((s: any) => s.name === af);
    const subRegistered = agents.some((a: any) => a.name === af);
    if (!registered && !subRegistered && !af.startsWith("oh-my-claudecode")) {
      report.orphan_agents.push(af);
    }
  }

  // 4. Unused MCP tools: tools registered but the MCP server doesn't export them
  const mcpTools = queryAll(db, "SELECT tool_name as name FROM mcp_tools ORDER BY tool_name") as any[];
  // The actual MCP tools are defined in server.ts — check what's exported
  const serverPath = join(ROOT, "src", "mcp", "server.ts");
  if (existsSync(serverPath)) {
    const serverSrc = require("fs").readFileSync(serverPath, "utf-8");
    for (const t of mcpTools) {
      if (!serverSrc.includes(t.name)) {
        report.unused_mcp_tools.push(t.name);
      }
    }
  }

  // 5. Dead modules: source files never imported from any command module
  const srcDir = join(ROOT, "src");
  const allSrcFiles: string[] = [];
  function walkDir(dir: string) {
    try {
      for (const entry of require("fs").readdirSync(dir, { withFileTypes: true })) {
        const fp = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "__tests__") walkDir(fp);
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
          allSrcFiles.push(fp.replace(srcDir, "").replace(/^[\\/]/, "").replace(/\\/g, "/"));
        }
      }
    } catch {}
  }
  walkDir(srcDir);

  // Build import graph: for each src file, collect its imports
  const importGraph = new Map<string, Set<string>>();
  for (const file of allSrcFiles) {
    const fp = join(srcDir, file);
    try {
      const content = require("fs").readFileSync(fp, "utf-8");
      const imports = new Set<string>();
      const importRe = /from\s+["']([^"']+)["']/g;
      let m;
      while ((m = importRe.exec(content))) {
        imports.add(m[1]!);
      }
      importGraph.set(file, imports);
    } catch {}
  }

  // Entry points that are always "alive"
  const entryPoints = new Set([
    "scripts/cli.ts", // CLI router
    "src/mcp/server.ts", // MCP server
    "src/automation-api.ts", // API server
    "src/server.ts", // Server
  ]);

  // Mark all reachable files
  const reachable = new Set<string>();
  function markReachable(file: string) {
    if (reachable.has(file)) return;
    reachable.add(file);
    const imports = importGraph.get(file);
    if (imports) {
      for (const imp of imports) {
        // Resolve relative imports to module paths
        const resolved = imp.startsWith(".")
          ? resolveRelative(join("src", file), imp)
          : imp;
        if (resolved && importGraph.has(resolved)) markReachable(resolved);
      }
    }
  }

  // Start from entry points
  for (const ep of entryPoints) {
    // Find matching source files
    for (const file of allSrcFiles) {
      if (ep.endsWith(file) || file.endsWith(ep.replace("scripts/", "").replace("src/", ""))) {
        markReachable(file);
      }
    }
  }

  // Also mark all files imported from commands/ — they're all reachable via MODULE_MAP
  for (const modPath of moduleFiles) {
    const relPath = modPath.replace("../src/", "");
    if (importGraph.has(relPath)) markReachable(relPath);
  }

  // Dead modules = source files not reachable
  for (const file of allSrcFiles) {
    if (!reachable.has(file) && !file.startsWith("commands/") && !file.includes("__tests__")) {
      report.dead_modules.push(file);
    }
  }

  report.total_dead = report.unresolved_commands.length + report.orphan_skills.length
    + report.orphan_agents.length + report.unused_mcp_tools.length + report.dead_modules.length;

  return report;
}

function resolveRelative(currentFile: string, importPath: string): string | null {
  if (!importPath.startsWith(".")) return null;
  const parts = currentFile.split("/");
  parts.pop(); // Remove filename
  for (const segment of importPath.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  const resolved = parts.join("/");
  // Try with .ts extension
  return resolved.endsWith(".ts") ? resolved : resolved + ".ts";
}
