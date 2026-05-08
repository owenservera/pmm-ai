/**
 * Self-Audit Linter — PMM-AI Checking Itself
 * ===========================================
 * Recursive lint: checks that PMM-AI's own structure is consistent.
 * Skills → agents, MCP tools → implementations, MODULE_MAP → files,
 * hooks → valid commands, settings → reachable scripts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { queryAll } from "../db";

const ROOT = join(import.meta.dir, "..", "..", "..");

export interface LintReport {
  checks: { name: string; passed: boolean; issue: string | null }[];
  passed: number;
  failed: number;
  critical: number;
}

export function lint(db: Database): LintReport {
  const report: LintReport = { checks: [], passed: 0, failed: 0, critical: 0 };

  function add(name: string, passed: boolean, issue: string | null, isCritical = false) {
    report.checks.push({ name, passed, issue });
    if (passed) report.passed++; else { report.failed++; if (isCritical) report.critical++; }
  }

  // ─── 1. MODULE_MAP resolution ──────────────────────────
  const MODULE_MAP: Record<string, string> = {
    project: "commands/project", tool: "commands/project",
    milestone: "commands/planning", feature: "commands/planning",
    roadblock: "commands/planning", decision: "commands/planning",
    task: "commands/tasks",
    roadmap: "commands/portfolio", node: "commands/portfolio", product: "commands/portfolio",
    agent: "commands/agents", worker: "commands/agents",
    session: "commands/session", health: "commands/health", check: "commands/health", doctor: "commands/health",
    evaluator: "commands/evaluator", oracle: "commands/oracle", mem: "commands/mem",
    swarm: "commands/swarm", layer: "commands/swarm", exec: "commands/swarm",
    config: "commands/ops", summary: "commands/ops", standards: "commands/ops",
    build: "commands/ops", deploy: "commands/ops", migrate: "commands/ops",
    process: "commands/ops", plan: "commands/ops", architect: "commands/ops",
    "protocol-align": "commands/ops",
    wizard: "commands/wizard", view: "commands/view", dashboard: "commands/view",
    start: "commands/mvp-start", new: "commands/mvp-start",
  };

  const pmmAiSrc = join(ROOT, "PMM-AI", "src");
  for (const [cmd, modPath] of Object.entries(MODULE_MAP)) {
    const fp = join(pmmAiSrc, modPath + ".ts");
    add(`CLI:${cmd} → ${modPath}.ts`, existsSync(fp), existsSync(fp) ? null : `Missing: ${fp}`, true);
  }

  // ─── 2. Skills → matching agent .md files ──────────────
  const skillsDir = join(ROOT, ".claude", "skills");
  const agentsDir = join(ROOT, ".claude", "agents");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillPath = join(skillsDir, entry, "SKILL.md");
      if (existsSync(skillPath)) {
        const content = readFileSync(skillPath, "utf-8");
        // Check for CLI references
        if (content.includes("bun scripts/pmm.ts") || content.includes("src/pmm/")) {
          add(`Skill:${entry} (legacy refs)`, false, "Contains legacy scripts/pmm.ts or src/pmm/ references", true);
        } else if (content.includes("PMM-AI/scripts/cli.ts") || content.includes("PMM-AI/src/")) {
          add(`Skill:${entry} (refs)`, true, null);
        } else {
          add(`Skill:${entry} (refs)`, false, "No PMM-AI CLI reference found", false);
        }
      }
    }
  }

  // ─── 3. Agent .md → registered in DB ───────────────────
  if (existsSync(agentsDir)) {
    const dbAgents = new Set((queryAll(db, "SELECT name FROM subagents") as any[]).map((a: any) => a.name));
    for (const entry of readdirSync(agentsDir)) {
      if (entry.endsWith(".md") && entry.startsWith("pmm-")) {
        const name = entry.replace(".md", "");
        add(`Agent:${name} (registered)`, dbAgents.has(name),
          dbAgents.has(name) ? null : "Not registered in PMM DB subagents table", true);
      }
    }
  }

  // ─── 4. Settings.local.json hook commands resolve ──────
  const settingsPath = join(ROOT, ".claude", "settings.local.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const hookCmds: string[] = [];
      for (const event of Object.values(settings.hooks ?? {}) as any[]) {
        for (const block of event) {
          for (const hook of block.hooks ?? []) {
            if (hook.command) hookCmds.push(hook.command);
          }
        }
      }
      for (const cmd of hookCmds) {
        if (cmd.includes("scripts/pmm.ts") || cmd.includes("src/pmm/")) {
          add(`Hook:${cmd.slice(0, 50)}`, false, "Legacy path reference", true);
        } else if (cmd.includes("bun PMM-AI/")) {
          // Extract the script path after "bun "
          const match = cmd.match(/bun\s+(PMM-AI\/\S+)/);
          if (match) {
            const scriptPath = join(ROOT, match[1]!);
            add(`Hook:${match[1]}`, existsSync(scriptPath),
              existsSync(scriptPath) ? null : `Script not found: ${scriptPath}`, true);
          }
        }
        // Skip non-bun commands (node, bash, etc)
      }
    } catch {}
  }

  // ─── 5. MCP server tools → all have implementations ────
  const mcpPath = join(ROOT, "PMM-AI", "src", "mcp", "server.ts");
  if (existsSync(mcpPath)) {
    const mcpSrc = readFileSync(mcpPath, "utf-8");
    const toolNames = [...mcpSrc.matchAll(/name:\s*["']([^"']+)["']/g)].map(m => m[1]!);
    const dbTools = (queryAll(db, "SELECT tool_name as name FROM mcp_tools") as any[]).map((t: any) => t.name);
    for (const tn of toolNames) {
      add(`MCP:${tn} (registered)`, dbTools.includes(tn),
        dbTools.includes(tn) ? null : "Tool not registered in DB", true);
    }
    for (const dt of dbTools) {
      if (!toolNames.includes(dt) && dt.startsWith("pmm_")) {
        add(`MCP:${dt} (implemented)`, false, "Registered in DB but no implementation found", true);
      }
    }
  }

  // ─── 6. .mcp.json server path resolves ─────────────────
  const mcpConfigPath = join(ROOT, ".mcp.json");
  if (existsSync(mcpConfigPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
      for (const [name, server] of Object.entries(mcpConfig.mcpServers ?? {}) as any[]) {
        if (server.args) {
          const serverPath = server.args[server.args.length - 1];
          if (serverPath && typeof serverPath === "string") {
            add(`MCP config:${name}`, existsSync(serverPath),
              existsSync(serverPath) ? null : `Server not found: ${serverPath}`, true);
          }
        }
      }
    } catch {}
  }

  return report;
}
