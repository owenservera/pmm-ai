#!/usr/bin/env bun
/**
 * PMM-AI — One-Command Harness Onboarding via bunx
 * ================================================
 *
 * Usage:
 *   bunx pmm-ai                    → Portfolio dashboard
 *   bunx pmm-ai setup              → Full harness onboarding (skills, MCP, hooks, DB)
 *   bunx pmm-ai unregister         → Remove PMM skills/hooks/MCP from current harness
 *   bunx pmm-ai start              → Launch dashboard
 *   bunx pmm-ai health             → Health check
 *
 * Zero-config. Detects your harness automatically.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..");
const CWD = process.cwd();
const ARGS = process.argv.slice(2);
const CMD = ARGS[0];

// ─── Harness Detection ─────────────────────────────────────────────────

type Harness = "claude-code" | "opencode" | "gemini" | "kilocode" | "antigravity" | "unknown";

interface HarnessProfile {
  name: string;
  skillsDir: string;
  settingsFile: string;
  mcpFile: string;
  hooksDir: string;
  skillFormat: "subdirectory" | "single-file";
  agentSpawn: string;
  cliPrefix: string;
}

function detectHarness(cwd: string): HarnessProfile {
  if (existsSync(join(cwd, ".claude", "settings.local.json"))) {
    return {
      name: "claude-code",
      skillsDir: join(cwd, ".claude", "skills"),
      settingsFile: join(cwd, ".claude", "settings.local.json"),
      mcpFile: join(cwd, ".mcp.json"),
      hooksDir: join(cwd, ".claude", "hooks"),
      skillFormat: "subdirectory",
      agentSpawn: "Task",
      cliPrefix: "bun PMM-AI/scripts/cli.ts",
    };
  }
  if (existsSync(join(cwd, ".opencode"))) {
    return {
      name: "opencode",
      skillsDir: join(cwd, ".opencode", "skills"),
      settingsFile: join(cwd, ".opencode", "config.json"),
      mcpFile: join(cwd, ".opencode", "mcp.json"),
      hooksDir: join(cwd, ".opencode", "hooks"),
      skillFormat: "subdirectory",
      agentSpawn: "agent",
      cliPrefix: "bun PMM-AI/scripts/cli.ts",
    };
  }
  if (existsSync(join(cwd, ".gemini"))) {
    return {
      name: "gemini",
      skillsDir: join(cwd, ".gemini", "skills"),
      settingsFile: join(cwd, ".gemini", "settings.json"),
      mcpFile: join(cwd, ".gemini", "mcp.json"),
      hooksDir: join(cwd, ".gemini", "hooks"),
      skillFormat: "subdirectory",
      agentSpawn: "delegate",
      cliPrefix: "bun PMM-AI/scripts/cli.ts",
    };
  }
  if (existsSync(join(cwd, ".kilocode"))) {
    return {
      name: "kilocode",
      skillsDir: join(cwd, ".kilocode", "skills"),
      settingsFile: join(cwd, ".kilocode", "settings.json"),
      mcpFile: join(cwd, ".kilocode", "mcp.json"),
      hooksDir: join(cwd, ".kilocode", "hooks"),
      skillFormat: "subdirectory",
      agentSpawn: "task",
      cliPrefix: "bun PMM-AI/scripts/cli.ts",
    };
  }
  // Antigravity
  if (existsSync(join(cwd, ".antigravity"))) {
    return {
      name: "antigravity",
      skillsDir: join(cwd, ".antigravity", "skills"),
      settingsFile: join(cwd, ".antigravity", "settings.json"),
      mcpFile: join(cwd, ".antigravity", "mcp.json"),
      hooksDir: join(cwd, ".antigravity", "hooks"),
      skillFormat: "subdirectory",
      agentSpawn: "spawn",
      cliPrefix: "bun PMM-AI/scripts/cli.ts",
    };
  }
  // Default to claude-code patterns (most common)
  return {
    name: "claude-code",
    skillsDir: join(cwd, ".claude", "skills"),
    settingsFile: join(cwd, ".claude", "settings.local.json"),
    mcpFile: join(cwd, ".mcp.json"),
    hooksDir: join(cwd, ".claude", "hooks"),
    skillFormat: "subdirectory",
    agentSpawn: "Task",
    cliPrefix: "bun PMM-AI/scripts/cli.ts",
  };
}

// ─── Skill Definitions ─────────────────────────────────────────────────

interface SkillDef {
  name: string;
  description: string;
  cliRef: string;
}

const PMM_SKILLS: SkillDef[] = [
  { name: "pmm-agent", description: "Background orchestrator — auto SessionStart, health, drift, session capture. Runs autonomously via hooks.", cliRef: "health" },
  { name: "pmm-onboard", description: "One-command project onboarding. Discovers tech stack, tools, git, registers in PMM DB. 4 modes: quick/standard/deep/interactive.", cliRef: "project onboard" },
  { name: "pmm-plan", description: "Interactive project planning. Milestones, features, roadblocks, decisions. Spawns pmm-planner agent.", cliRef: "plan" },
  { name: "pmm-health", description: "Portfolio health check with P0/P1/P2. Scans all projects for staleness, roadblocks, overdue milestones.", cliRef: "health" },
  { name: "pmm-worker", description: "Agent worker lifecycle protocol. Dispatch, track, and manage agent workers.", cliRef: "worker dispatch" },
  { name: "pmm-evaluator", description: "Quality evaluation gates. Agent-as-Judge for complex output quality assessment.", cliRef: "evaluator run" },
  { name: "pmm-capture", description: "Session capture + continuity handoff. Mines conversations, generates capsules, enables resume.", cliRef: "session capture" },
  { name: "pmm-visualize", description: "HTML dashboards: Gantt, kanban, health gauges, portfolio trees, timeline views. No build step.", cliRef: "view" },
  { name: "pmm-architect", description: "Structural architecture analysis + refactoring. 3 intensity tiers, multi-project support.", cliRef: "architect review" },
  { name: "pmm-drift", description: "Configuration drift detection. Compares CLAUDE.md, hooks, MCP, skills against PMM DB.", cliRef: "agent list" },
  { name: "pmm-standards", description: "Standards compliance checking across all PMM-managed projects. File, config, pattern checks.", cliRef: "standards check" },
  { name: "pmm-docs-standard", description: "Two-file doc standardization: AGENTS.md + PMM/<project>/project.md for every project.", cliRef: "standards check" },
  { name: "pmm-worker", description: "Worker lifecycle: dispatch → spawn → track → self-report. Registration policy enforcement.", cliRef: "worker dispatch" },
];

// Deduplicate
const UNIQUE_SKILLS = PMM_SKILLS.filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i);

// ─── Skill Template ────────────────────────────────────────────────────

function generateSkillMd(skill: SkillDef, harness: HarnessProfile): string {
  return `# ${skill.name}

${skill.description}

## Quick Reference

\`\`\`
${harness.cliPrefix} ${skill.cliRef}
\`\`\`

## How It Works

This skill is auto-managed by PMM-AI. To update, run \`bunx pmm-ai setup\` again.

## Integration

- Installed by: \`bunx pmm-ai setup\`
- Harness: ${harness.name}
- CLI: \`${harness.cliPrefix}\`

## Manual Commands

\`\`\`
${harness.cliPrefix} help    — Full command reference
${harness.cliPrefix} start   — Portfolio dashboard
${harness.cliPrefix} health  — Health check
\`\`\`
`;
}

// ─── Setup ─────────────────────────────────────────────────────────────

async function setup() {
  const harness = detectHarness(CWD);

  console.log("");
  console.log("\x1b[34m═══ PMM-AI Setup ─── \x1b[0m");
  console.log("  Harness: \x1b[32m" + harness.name + "\x1b[0m");
  console.log("  Path:    " + CWD);
  console.log("");

  // Step 1: Ensure PMM-AI is accessible
  let pmmAiPath = join(CWD, "PMM-AI");
  if (!existsSync(pmmAiPath)) {
    // Check if PMM-AI is installed globally or needs to be linked
    pmmAiPath = ROOT; // Use the package's own location
    console.log("  PMM-AI:  " + pmmAiPath);
  }
  console.log("  PMM-AI:  " + (existsSync(pmmAiPath) ? "\x1b[32mfound\x1b[0m" : "\x1b[31mnot found\x1b[0m"));
  if (!existsSync(pmmAiPath)) {
    console.log("");
    console.log("  Run: git clone <pmm-ai-repo> PMM-AI");
    process.exit(1);
  }

  // Step 2: Initialize DB if needed
  const dbPath = join(pmmAiPath, "data", "pmm.db");
  if (!existsSync(dbPath)) {
    console.log("  DB:      \x1b[33minitializing...\x1b[0m");
    try {
      mkdirSync(join(pmmAiPath, "data"), { recursive: true });
      // Run schema init via bun
      spawnSync("bun", ["-e", `
        import { openDb } from '${pmmAiPath.replace(/\\/g, "/")}/src/db';
        import { initSchema } from '${pmmAiPath.replace(/\\/g, "/")}/src/schema';
        const db = openDb();
        initSchema(db);
        console.log("DB initialized");
        db.close();
      `], { stdio: "inherit", cwd: CWD });
    } catch (e: any) {
      console.log("  DB:      \x1b[31mfailed\x1b[0m — " + e.message);
    }
  } else {
    console.log("  DB:      \x1b[32mready\x1b[0m");
  }

  // Step 3: Register skills
  console.log("  Skills:  registering " + UNIQUE_SKILLS.length + " skills...");
  try {
    mkdirSync(harness.skillsDir, { recursive: true });
  } catch {}
  for (const skill of UNIQUE_SKILLS) {
    const skillDir = join(harness.skillsDir, skill.name);
    try { mkdirSync(skillDir, { recursive: true }); } catch {}
    const skillMd = generateSkillMd(skill, harness);
    writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");
  }
  console.log("  Skills:  \x1b[32m" + UNIQUE_SKILLS.length + " registered\x1b[0m");

  // Step 4: Write MCP config
  const mcpEntry = {
    pmm: {
      type: "stdio",
      command: "bun",
      args: ["run", join(pmmAiPath, "src", "mcp", "server.ts").replace(/\\/g, "/")],
    },
  };

  let mcpConfig: any = {};
  if (existsSync(harness.mcpFile)) {
    try { mcpConfig = JSON.parse(readFileSync(harness.mcpFile, "utf-8")); } catch {}
  }
  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
  Object.assign(mcpConfig.mcpServers, mcpEntry);
  writeFileSync(harness.mcpFile, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  console.log("  MCP:     \x1b[32mconfigured\x1b[0m (" + harness.mcpFile + ")");

  // Step 5: Write hooks to settings
  let settings: any = {};
  const settingsPath = harness.settingsFile;
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}
  }

  if (!settings.hooks) settings.hooks = {};

  // SessionStart hook
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [{ matcher: "", hooks: [] }];
  const sessionStart = settings.hooks.SessionStart[0];
  const startCommands = [
    { type: "command", command: harness.cliPrefix + " health", timeout: 10000 },
  ];
  // Merge without duplicating
  for (const cmd of startCommands) {
    if (!sessionStart.hooks.some((h: any) => h.command === cmd.command)) {
      sessionStart.hooks.push(cmd);
    }
  }

  // Stop hook
  if (!settings.hooks.Stop) settings.hooks.Stop = [{ hooks: [] }];
  const stopHook = settings.hooks.Stop[0];
  const stopCommands = [
    { type: "command", command: harness.cliPrefix + " session verify-protocol 2>&1 || echo '⚠ PMM protocol incomplete'", timeout: 5000 },
    { type: "command", command: harness.cliPrefix + " mem sync", timeout: 5000 },
  ];
  for (const cmd of stopCommands) {
    if (!stopHook.hooks.some((h: any) => h.command === cmd.command)) {
      stopHook.hooks.push(cmd);
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  console.log("  Hooks:   \x1b[32mconfigured\x1b[0m (" + settingsPath + ")");

  // Step 6: Try to register current project
  console.log("");
  console.log("  \x1b[34mRegistering current project...\x1b[0m");
  try {
    const pkgPath = join(CWD, "package.json");
    let projectName = CWD.split(/[/\\]/).pop() || "unknown";
    let stack = "";
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      projectName = pkg.name || projectName;
      stack = Object.keys(pkg.dependencies || {}).slice(0, 5).join(", ");
    }

    const result = spawnSync("bun", [
      join(pmmAiPath, "scripts", "cli.ts"),
      "project", "register", projectName,
      "--phase", "discover",
      "--priority", "medium",
      "--stack", stack || "unknown",
      "--path", CWD,
    ], { cwd: CWD, encoding: "utf-8" });

    if (result.exitCode === 0) {
      console.log("  \x1b[32m✓\x1b[0m Project \"" + projectName + "\" registered");
    } else {
      console.log("  \x1b[33m○\x1b[0m Project may already be registered or registration skipped");
    }
  } catch (e: any) {
    console.log("  \x1b[2m○\x1b[0m Project registration skipped (no package.json)");
  }

  // Step 7: Done
  console.log("");
  console.log("  \x1b[32m╔══════════════════════════════════════╗\x1b[0m");
  console.log("  \x1b[32m║   PMM-AI is ready!                  ║\x1b[0m");
  console.log("  \x1b[32m╚══════════════════════════════════════╝\x1b[0m");
  console.log("");
  console.log("  Next steps:");
  console.log("    " + harness.cliPrefix + " start        → Portfolio dashboard");
  console.log("    " + harness.cliPrefix + " health       → Health check");
  console.log("    " + harness.cliPrefix + " wizard       → Interactive project setup");
  console.log("    " + harness.cliPrefix + " tooling all  → Full platform scan");
  console.log("");

  // Try to show dashboard
  try {
    spawnSync("bun", [join(pmmAiPath, "scripts", "cli.ts"), "start"], {
      cwd: CWD,
      stdio: "inherit",
      timeout: 5000,
    });
  } catch {}
}

// ─── Unregister ────────────────────────────────────────────────────────

async function unregister() {
  const harness = detectHarness(CWD);

  console.log("");
  console.log("\x1b[34m═══ PMM-AI Unregister ─── \x1b[0m");
  console.log("  Harness: " + harness.name);
  console.log("");

  // Remove PMM skills
  let removedSkills = 0;
  if (existsSync(harness.skillsDir)) {
    for (const entry of readdirSync(harness.skillsDir)) {
      if (entry.startsWith("pmm-")) {
        try {
          rmSync(join(harness.skillsDir, entry), { recursive: true });
          removedSkills++;
        } catch {}
      }
    }
  }
  console.log("  Skills:  \x1b[33m" + removedSkills + " removed\x1b[0m");

  // Remove PMM from MCP config
  if (existsSync(harness.mcpFile)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(harness.mcpFile, "utf-8"));
      if (mcpConfig.mcpServers?.pmm) {
        delete mcpConfig.mcpServers.pmm;
        writeFileSync(harness.mcpFile, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
        console.log("  MCP:     \x1b[33mpmm server removed\x1b[0m");
      }
    } catch {}
  }

  // Remove PMM hooks from settings
  if (existsSync(harness.settingsFile)) {
    try {
      const settings = JSON.parse(readFileSync(harness.settingsFile, "utf-8"));
      let hooksRemoved = 0;
      for (const event of Object.keys(settings.hooks || {})) {
        for (const block of settings.hooks[event] || []) {
          if (block.hooks) {
            block.hooks = block.hooks.filter((h: any) => {
              if (h.command && (h.command.includes("PMM-AI") || h.command.includes("pmm.ts"))) {
                hooksRemoved++;
                return false;
              }
              return true;
            });
          }
        }
      }
      writeFileSync(harness.settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
      console.log("  Hooks:   \x1b[33m" + hooksRemoved + " removed\x1b[0m");
    } catch {}
  }

  console.log("");
  console.log("  \x1b[33mPMM-AI unregistered. Data preserved in PMM-AI/data/\x1b[0m");
  console.log("  Run \x1b[32mbunx pmm-ai setup\x1b[0m to re-register.");
  console.log("");
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  switch (CMD) {
    case "setup":
    case "install":
    case "init":
      return await setup();

    case "unregister":
    case "remove":
    case "cleanup":
      return await unregister();

    case "help":
    case "--help":
    case "-h":
      console.log("");
      console.log("PMM-AI — Autonomous Development Platform");
      console.log("");
      console.log("Usage: bunx pmm-ai [command]");
      console.log("");
      console.log("Commands:");
      console.log("  setup            Full harness onboarding (skills, MCP, hooks, DB)");
      console.log("  unregister        Remove PMM skills/hooks/MCP from current harness");
      console.log("  (no args)         Portfolio dashboard (same as pmm start)");
      console.log("  health            Health check");
      console.log("  help              This message");
      console.log("");
      break;

    default:
      // Default: show portfolio via CLI
      try {
        const cliPath = join(ROOT, "scripts", "cli.ts");
        const allArgs = CMD ? [CMD, ...ARGS.slice(1)] : ["start"];
        spawnSync("bun", [cliPath, ...allArgs], { cwd: CWD, stdio: "inherit" });
      } catch {
        console.log("PMM-AI CLI not available. Run bunx pmm-ai setup first.");
      }
  }
}

main().catch((err) => {
  console.error("PMM-AI error:", err.message);
  process.exit(1);
});
