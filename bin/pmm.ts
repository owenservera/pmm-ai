#!/usr/bin/env bun
/**
 * PMM-AI — One-Command Harness Onboarding via bunx
 * ================================================
 *
 * Usage:
 *   bunx pmm-ai                    → First-run wizard or portfolio dashboard
 *   bunx pmm-ai setup              → Full harness onboarding (skills, MCP, hooks, DB)
 *   bunx pmm-ai setup --local       → Local install only
 *   bunx pmm-ai setup --global      → Global install only
 *   bunx pmm-ai setup --both        → Both global + local install (default: interactive)
 *   bunx pmm-ai unregister         → Remove PMM skills/hooks/MCP from current harness
 *   bunx pmm-ai start              → Launch dashboard
 *   bunx pmm-ai health             → Health check
 *
 * Zero-config. Auto-detects harness. Interactive when needed.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const ROOT = resolve(import.meta.dir, "..");
const CWD = process.cwd();
const HOME = homedir();
const ARGS = process.argv.slice(2);
const CMD = ARGS[0];
const FLAGS = new Set(ARGS.filter(a => a.startsWith("--")));
const IS_INTERACTIVE = process.stdout.isTTY && !FLAGS.has("--no-interactive");

// ─── Interactive Prompts ───────────────────────────────────────────────

function rl() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const iface = rl();
    iface.question(question, (answer) => {
      iface.close();
      resolve(answer.trim());
    });
  });
}

async function select<T>(question: string, options: { label: string; value: T }[], defaultIdx = 0): Promise<T> {
  console.log(`\n${question}`);
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? ">" : " ";
    console.log(`  \x1b[${i === defaultIdx ? "1;36m" : "2m"}${marker} [${i + 1}] ${options[i].label}\x1b[0m`);
  }
  const raw = await ask(`\x1b[2mPick [${defaultIdx + 1}]\x1b[0m `);
  if (!raw) return options[defaultIdx].value;
  const idx = parseInt(raw) - 1;
  if (idx >= 0 && idx < options.length) return options[idx].value;
  return options[defaultIdx].value;
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const yn = defaultYes ? "Y/n" : "y/N";
  const raw = await ask(`${question} \x1b[2m[${yn}]\x1b[0m `);
  if (!raw) return defaultYes;
  return raw.toLowerCase().startsWith("y");
}

// ─── Progress ───────────────────────────────────────────────────────────

let _stepNum = 0;

function step(label: string) {
  _stepNum++;
  process.stdout.write(`  \x1b[34m[${_stepNum}]\x1b[0m ${label}... `);
}

function ok(msg?: string) {
  process.stdout.write(msg ? `\x1b[32m${msg}\x1b[0m\n` : `\x1b[32m✓\x1b[0m\n`);
}

function warn(msg: string) {
  process.stdout.write(`\x1b[33m${msg}\x1b[0m\n`);
}

function fail(msg: string) {
  process.stdout.write(`\x1b[31m${msg}\x1b[0m\n`);
}

function info(msg: string) {
  console.log(`  \x1b[2m${msg}\x1b[0m`);
}

// ─── Harness Profiles ──────────────────────────────────────────────────

interface HarnessProfile {
  name: string;
  skillsDir: string;
  settingsFile: string;
  mcpFile: string;
  hooksDir: string;
  skillFormat: "subdirectory" | "single-file";
  agentSpawn: string;
  cliPrefix: string;
  /** Detected in current CWD */
  detected: boolean;
}

const ALL_HARNESSES: { name: string; dirName: string; skillsDir: string; settingsFile: string; mcpFile: string; hooksDir: string; agentSpawn: string }[] = [
  { name: "claude-code", dirName: ".claude", skillsDir: ".claude/skills", settingsFile: ".claude/settings.local.json", mcpFile: ".mcp.json", hooksDir: ".claude/hooks", agentSpawn: "Task" },
  { name: "opencode", dirName: ".opencode", skillsDir: ".opencode/skills", settingsFile: ".opencode/config.json", mcpFile: ".opencode/mcp.json", hooksDir: ".opencode/hooks", agentSpawn: "agent" },
  { name: "gemini", dirName: ".gemini", skillsDir: ".gemini/skills", settingsFile: ".gemini/settings.json", mcpFile: ".gemini/mcp.json", hooksDir: ".gemini/hooks", agentSpawn: "delegate" },
  { name: "kilocode", dirName: ".kilocode", skillsDir: ".kilocode/skills", settingsFile: ".kilocode/settings.json", mcpFile: ".kilocode/mcp.json", hooksDir: ".kilocode/hooks", agentSpawn: "task" },
  { name: "antigravity", dirName: ".antigravity", skillsDir: ".antigravity/skills", settingsFile: ".antigravity/settings.json", mcpFile: ".antigravity/mcp.json", hooksDir: ".antigravity/hooks", agentSpawn: "spawn" },
];

function detectAllHarnesses(cwd: string): HarnessProfile[] {
  return ALL_HARNESSES.map(h => ({
    name: h.name,
    skillsDir: join(cwd, h.skillsDir),
    settingsFile: join(cwd, h.settingsFile),
    mcpFile: join(cwd, h.mcpFile),
    hooksDir: join(cwd, h.hooksDir),
    skillFormat: "subdirectory" as const,
    agentSpawn: h.agentSpawn,
    cliPrefix: "bun PMM-AI/scripts/cli.ts",
    detected: existsSync(join(cwd, h.dirName)),
  }));
}

function detectHarness(cwd: string): HarnessProfile {
  const all = detectAllHarnesses(cwd);
  const detected = all.filter(h => h.detected);
  // Return first detected, or claude-code as default
  return detected[0] || all[0];
}

function buildHarnessProfile(name: string, cwd: string, isGlobal: boolean, cliPrefix: string): HarnessProfile {
  const base = ALL_HARNESSES.find(h => h.name === name) || ALL_HARNESSES[0];
  const root = isGlobal ? join(HOME, base.dirName) : cwd;
  return {
    name: base.name,
    skillsDir: isGlobal ? join(HOME, base.skillsDir) : join(cwd, base.skillsDir),
    settingsFile: isGlobal ? join(HOME, base.settingsFile) : join(cwd, base.settingsFile),
    mcpFile: isGlobal ? join(HOME, base.mcpFile) : join(cwd, base.mcpFile),
    hooksDir: isGlobal ? join(HOME, base.hooksDir) : join(cwd, base.hooksDir),
    skillFormat: "subdirectory",
    agentSpawn: base.agentSpawn,
    cliPrefix,
    detected: existsSync(join(root, base.dirName)),
  };
}

// ─── First-Run Detection ────────────────────────────────────────────────

const PPP_DB = join(HOME, ".pmm-ai", "data", "pmm.db");

function isFirstRun(): boolean {
  return !existsSync(PPP_DB);
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
];

// Deduplicate
const UNIQUE_SKILLS = PMM_SKILLS.filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i);

// ─── Skill Template ────────────────────────────────────────────────────

function generateSkillMd(skill: SkillDef, cliPrefix: string): string {
  return `# ${skill.name}

${skill.description}

## Quick Reference

\`\`\`
${cliPrefix} ${skill.cliRef}
\`\`\`

## How It Works

This skill is auto-managed by PMM-AI. To update, run \`bunx pmm-ai setup\` again.

## Integration

- Installed by: \`bunx pmm-ai setup\`
- CLI: \`${cliPrefix}\`

## Manual Commands

\`\`\`
${cliPrefix} help    — Full command reference
${cliPrefix} start   — Portfolio dashboard
${cliPrefix} health  — Health check
\`\`\`
`;
}

// ─── First-Run Wizard ──────────────────────────────────────────────────

interface WizardConfig {
  harnessName: string;
  installScope: "local" | "global" | "both";
}

async function firstRunWizard(): Promise<WizardConfig> {
  console.log("");
  console.log("\x1b[35m  ╔══════════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[35m  ║   Welcome to PMM-AI!                     ║\x1b[0m");
  console.log("\x1b[35m  ║   Autonomous Development Platform        ║\x1b[0m");
  console.log("\x1b[35m  ╚══════════════════════════════════════════╝\x1b[0m");
  console.log("");
  console.log("  Let's get you set up. I'll ask a few questions.");
  console.log("");

  // 1. Select harness
  const detected = detectAllHarnesses(CWD);
  const detectedList = detected.filter(h => h.detected);
  let harnessName: string;

  if (detectedList.length === 0) {
    console.log("  \x1b[2mNo AI harness detected in current directory.\x1b[0m");
    harnessName = await select("Which AI coding tool do you use?",
      ALL_HARNESSES.map((h, i) => ({ label: h.name, value: h.name })),
      0);
  } else if (detectedList.length === 1) {
    harnessName = detectedList[0].name;
    const ok = await confirm(`Detected ${harnessName}. Use this?`, true);
    if (!ok) {
      harnessName = await select("Which AI coding tool do you use?",
        ALL_HARNESSES.map((h, i) => ({ label: h.name, value: h.name })),
        0);
    }
  } else {
    // Multiple detected — let user pick
    harnessName = await select("Multiple AI harnesses detected. Which one should PMM-AI integrate with?",
      detectedList.map(h => ({ label: `${h.name} (detected)`, value: h.name })),
      0);
  }

  // 2. Install scope
  const scope = await select<any>("Where should PMM-AI skills and hooks be installed?",
    [
      { label: "Local only — ./.claude/skills/ (for this project)", value: "local" },
      { label: "Global only — ~/.claude/skills/ (all projects)", value: "global" },
      { label: "Both — local + global (recommended)", value: "both" },
    ],
    2); // default to "both"

  // 3. Confirm
  console.log("");
  console.log("  \x1b[34m═══ Configuration Summary ═══\x1b[0m");
  console.log(`  Harness:       \x1b[32m${harnessName}\x1b[0m`);
  console.log(`  Install scope: \x1b[32m${scope}\x1b[0m`);
  console.log(`  DB location:   \x1b[2m${PPP_DB}\x1b[0m`);
  console.log("");

  const go = await confirm("Proceed with setup?", true);
  if (!go) {
    console.log("  Setup cancelled. Run \x1b[32mbunx pmm-ai setup\x1b[0m anytime.");
    process.exit(0);
  }

  return { harnessName, installScope: scope };
}

// ─── DB Init ────────────────────────────────────────────────────────────

function initDatabase(pmmAiPath: string): boolean {
  step("Initializing database");
  try {
    spawnSync("bun", ["-e", `
      import { ensureDb } from '${pmmAiPath.replace(/\\/g, "/")}/src/db';
      const path = ensureDb();
      console.log(path);
    `], { stdio: "pipe", cwd: CWD });
    ok();
    return true;
  } catch (e: any) {
    fail("failed — " + e.message);
    return false;
  }
}

// ─── Skills Install ─────────────────────────────────────────────────────

function installSkills(harness: HarnessProfile, cliPrefix: string): number {
  try { mkdirSync(harness.skillsDir, { recursive: true }); } catch {}
  let count = 0;
  for (const skill of UNIQUE_SKILLS) {
    try {
      const skillDir = join(harness.skillsDir, skill.name);
      mkdirSync(skillDir, { recursive: true });
      const skillMd = generateSkillMd(skill, cliPrefix);
      writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");
      count++;
    } catch {}
  }
  return count;
}

// ─── MCP Config ────────────────────────────────────────────────────────

function installMcp(harness: HarnessProfile, pmmAiPath: string): boolean {
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
  return true;
}

// ─── Hooks Install ─────────────────────────────────────────────────────

function installHooks(harness: HarnessProfile, cliPrefix: string): boolean {
  let settings: any = {};
  if (existsSync(harness.settingsFile)) {
    try { settings = JSON.parse(readFileSync(harness.settingsFile, "utf-8")); } catch {}
  }
  if (!settings.hooks) settings.hooks = {};

  // SessionStart hook
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [{ matcher: "", hooks: [] }];
  const sessionStart = settings.hooks.SessionStart[0];
  const startCommands = [
    { type: "command", command: cliPrefix + " health", timeout: 10000 },
  ];
  for (const cmd of startCommands) {
    if (!sessionStart.hooks.some((h: any) => h.command === cmd.command)) {
      sessionStart.hooks.push(cmd);
    }
  }

  // Stop hook
  if (!settings.hooks.Stop) settings.hooks.Stop = [{ hooks: [] }];
  const stopHook = settings.hooks.Stop[0];
  const stopCommands = [
    { type: "command", command: cliPrefix + " session verify-protocol 2>&1 || echo '⚠ PMM protocol incomplete'", timeout: 5000 },
    { type: "command", command: cliPrefix + " mem sync", timeout: 5000 },
  ];
  for (const cmd of stopCommands) {
    if (!stopHook.hooks.some((h: any) => h.command === cmd.command)) {
      stopHook.hooks.push(cmd);
    }
  }

  writeFileSync(harness.settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  return true;
}

// ─── Project Registration ──────────────────────────────────────────────

function registerProject(pmmAiPath: string, cliPrefix: string): void {
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
    ], { cwd: CWD, encoding: "utf-8", stdio: "pipe" });

    if (result.exitCode === 0) {
      ok(`registered "${projectName}"`);
    } else {
      warn("skipped (already registered or no package.json)");
    }
  } catch {
    warn("skipped (no package.json)");
  }
}

// ─── Setup Orchestrator ────────────────────────────────────────────────

type InstallScope = "local" | "global" | "both";

async function runSetup(harnessName: string, scope: InstallScope) {
  _stepNum = 0;

  console.log("");
  console.log("\x1b[34m═══ PMM-AI Setup ─── \x1b[0m");
  console.log(`  Harness: \x1b[32m${harnessName}\x1b[0m`);
  console.log(`  Scope:   \x1b[32m${scope}\x1b[0m`);
  console.log(`  Path:    ${CWD}`);
  console.log("");

  // Resolve PMM-AI source path
  let pmmAiPath = join(CWD, "PMM-AI");
  if (!existsSync(pmmAiPath)) {
    pmmAiPath = ROOT; // Use the package's own location (global bunx)
  }
  if (!existsSync(pmmAiPath)) {
    fail("PMM-AI not found. Run: git clone <pmm-ai-repo> PMM-AI");
    process.exit(1);
  }
  info(`source: ${pmmAiPath}`);

  // Determine CLI prefix for each scope
  const localCliPrefix = "bun PMM-AI/scripts/cli.ts";
  const globalCliPrefix = "bunx pmm-ai";

  // Initialize DB (once, shared)
  if (isFirstRun()) {
    info("first run detected — initializing database");
    initDatabase(pmmAiPath);
  } else {
    info("database ready");
  }

  // Track what was done for final summary
  let skillsCount = 0;
  const done: string[] = [];

  // ── Global Install ──
  if (scope === "global" || scope === "both") {
    const globalHarness = buildHarnessProfile(harnessName, CWD, true, globalCliPrefix);

    step(`Installing skills to ${globalHarness.skillsDir}`);
    const n = installSkills(globalHarness, globalCliPrefix);
    skillsCount = n;
    ok(`${n} skills`);

    step(`Configuring MCP (${globalHarness.mcpFile})`);
    installMcp(globalHarness, pmmAiPath);
    ok();

    step(`Configuring hooks (${globalHarness.settingsFile})`);
    installHooks(globalHarness, globalCliPrefix);
    ok();

    done.push("global");
  }

  // ── Local Install ──
  if (scope === "local" || scope === "both") {
    const localHarness = buildHarnessProfile(harnessName, CWD, false, localCliPrefix);

    step(`Installing skills to ${localHarness.skillsDir}`);
    const n = installSkills(localHarness, localCliPrefix);
    skillsCount = n;
    ok(`${n} skills`);

    step(`Configuring MCP (${localHarness.mcpFile})`);
    installMcp(localHarness, pmmAiPath);
    ok();

    step(`Configuring hooks (${localHarness.settingsFile})`);
    installHooks(localHarness, localCliPrefix);
    ok();

    done.push("local");
  }

  // ── Register current project ──
  const primaryCli = scope === "global" ? globalCliPrefix : localCliPrefix;
  step("Registering current project");
  registerProject(pmmAiPath, primaryCli);

  // ── Done ──
  console.log("");
  console.log("\x1b[32m  ╔══════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[32m  ║   PMM-AI is ready!                  ║\x1b[0m");
  console.log("\x1b[32m  ╚══════════════════════════════════════╝\x1b[0m");
  console.log("");
  console.log(`  Skills:   \x1b[32m${skillsCount}\x1b[0m registered to ${done.join(" + ")}`);
  console.log(`  Database: \x1b[2m${PPP_DB}\x1b[0m`);
  console.log("");
  console.log("  Next steps:");
  if (scope === "global" || scope === "both") {
    console.log(`    \x1b[1m${globalCliPrefix} start\x1b[0m        → Portfolio dashboard`);
    console.log(`    \x1b[1m${globalCliPrefix} health\x1b[0m       → Health check`);
    console.log(`    \x1b[1m${globalCliPrefix} wizard\x1b[0m       → Interactive project setup`);
  }
  if (scope === "local") {
    console.log(`    \x1b[1m${localCliPrefix} start\x1b[0m         → Portfolio dashboard`);
    console.log(`    \x1b[1m${localCliPrefix} health\x1b[0m        → Health check`);
  }
  console.log("");

  // Try to show dashboard
  try {
    spawnSync("bun", [join(pmmAiPath, "scripts", "cli.ts"), "start"], {
      cwd: CWD, stdio: "inherit", timeout: 5000,
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
  console.log("  \x1b[33mPMM-AI unregistered. Data preserved in ~/.pmm-ai/data/\x1b[0m");
  console.log("  Run \x1b[32mbunx pmm-ai setup\x1b[0m to re-register.");
  console.log("");
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  switch (CMD) {
    case "setup":
    case "install":
    case "init": {
      // Parse scope flags
      let scope: InstallScope | null = null;
      if (FLAGS.has("--local")) scope = "local";
      else if (FLAGS.has("--global")) scope = "global";
      else if (FLAGS.has("--both")) scope = "both";

      if (scope && IS_INTERACTIVE) {
        // Non-interactive mode: auto-detect harness
        const harness = detectHarness(CWD);
        return await runSetup(harness.name, scope);
      }

      if (scope) {
        // Non-interactive, explicit scope
        const harness = detectHarness(CWD);
        return await runSetup(harness.name, scope);
      }

      if (IS_INTERACTIVE && isFirstRun()) {
        // Interactive first-run wizard
        const config = await firstRunWizard();
        return await runSetup(config.harnessName, config.installScope);
      }

      if (IS_INTERACTIVE) {
        // Re-setup — quick confirm
        const harness = detectHarness(CWD);
        console.log("");
        console.log("\x1b[34m═══ PMM-AI Setup ─── \x1b[0m");
        console.log(`  Harness: \x1b[32m${harness.name}\x1b[0m (auto-detected)`);
        console.log("");
        const go = await confirm("Re-run setup? This will update skills, MCP, and hooks.", true);
        if (!go) { console.log("  Cancelled."); process.exit(0); }
        const scope = await select<any>("Install scope?",
          [
            { label: "Local only", value: "local" },
            { label: "Global only", value: "global" },
            { label: "Both (recommended)", value: "both" },
          ], 2);
        return await runSetup(harness.name, scope);
      }

      // Non-interactive: auto-detect, local only
      const harness = detectHarness(CWD);
      return await runSetup(harness.name, "local");
    }

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
      console.log("Usage: bunx pmm-ai [command] [flags]");
      console.log("");
      console.log("Commands:");
      console.log("  setup            Harness onboarding (skills, MCP, hooks, DB)");
      console.log("  setup --global   Global install only (~/.claude/skills/)");
      console.log("  setup --local    Local install only (./.claude/skills/)");
      console.log("  setup --both     Both global + local");
      console.log("  unregister       Remove PMM skills/hooks/MCP from current harness");
      console.log("  (no args)        First-run wizard or portfolio dashboard");
      console.log("  health           Health check");
      console.log("  help             This message");
      console.log("");
      console.log("Flags:");
      console.log("  --no-interactive Skip all prompts (use with --local/--global/--both)");
      console.log("");
      break;

    default:
      // Default: first-run wizard or portfolio dashboard
      if (IS_INTERACTIVE && isFirstRun()) {
        const config = await firstRunWizard();
        return await runSetup(config.harnessName, config.installScope);
      }
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
