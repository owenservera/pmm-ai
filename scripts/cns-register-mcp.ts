#!/usr/bin/env bun
/**
 * CNS — MCP Server Registration
 * ==============================
 * Registers the PMM MCP server into every supported harness config.
 * Designed to be called directly OR from the interactive setup wizard.
 *
 * Usage:
 *   bun scripts/cns-register-mcp.ts              # register all detected harnesses
 *   bun scripts/cns-register-mcp.ts --dry-run    # show what would change, no writes
 *   bun scripts/cns-register-mcp.ts --harness windsurf,gemini-cli
 *   bun scripts/cns-register-mcp.ts --status     # show current registration state
 *
 * Architecture: manifest-driven so the interactive setup wizard (`cns-setup.ts`)
 * can call `detectHarnesses()` and `registerHarness()` without duplication.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOME = homedir();
const APPDATA = process.env.APPDATA ?? join(HOME, "AppData", "Roaming");
const TERMINAL_ROOT = resolve(join(import.meta.dir, ".."));
const MCP_SERVER_PATH = join(TERMINAL_ROOT, "src", "pmm", "mcp", "server.ts");

// ── The PMM MCP entry (harness-format-independent) ──────────────────────────

const PMM_MCP_ENTRY = {
  command: "bun",
  args: [MCP_SERVER_PATH],
  env: {},
  description: "PMM — Centralized Agentic Nervous System",
};

// ── Harness Manifest ─────────────────────────────────────────────────────────
// Each harness declares:
//   configPath: where the MCP config file lives
//   format: how to read/write the `mcpServers` key
//   detect: () => boolean — is this harness installed?
//   read/write: JSON manipulation for this harness's specific format

export interface HarnessManifest {
  id: string;
  label: string;
  configPath: string;
  /** Does this harness appear to be installed? */
  detect: () => boolean;
  /** Read current mcpServers from config, returning {} if none */
  readServers: (config: any) => Record<string, any>;
  /** Write new mcpServers back into config object (mutates) */
  writeServers: (config: any, servers: Record<string, any>) => void;
  /** How to format the PMM entry for this harness */
  entryFormat: () => any;
}

export const HARNESS_MANIFEST: HarnessManifest[] = [
  // ── Claude Code ────────────────────────────────────────────────────────────
  {
    id: "claude-code",
    label: "Claude Code",
    configPath: join(HOME, ".claude", "settings.json"),
    detect: () => existsSync(join(HOME, ".claude", "settings.json")),
    readServers: (cfg) => cfg.mcpServers ?? {},
    writeServers: (cfg, servers) => { cfg.mcpServers = servers; },
    entryFormat: () => ({
      command: "bun",
      args: [MCP_SERVER_PATH],
    }),
  },

  // ── Windsurf ───────────────────────────────────────────────────────────────
  {
    id: "windsurf",
    label: "Windsurf IDE",
    configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    detect: () => existsSync(join(HOME, ".codeium", "windsurf")),
    readServers: (cfg) => cfg.mcpServers ?? {},
    writeServers: (cfg, servers) => { cfg.mcpServers = servers; },
    entryFormat: () => ({
      command: "bun",
      args: [MCP_SERVER_PATH],
      env: {},
      disabled: false,
    }),
  },

  // ── Gemini CLI ─────────────────────────────────────────────────────────────
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    configPath: join(HOME, ".gemini", "settings.json"),
    detect: () => existsSync(join(HOME, ".gemini", "settings.json")),
    readServers: (cfg) => cfg.mcpServers ?? {},
    writeServers: (cfg, servers) => { cfg.mcpServers = servers; },
    entryFormat: () => ({
      command: "bun",
      args: [MCP_SERVER_PATH],
    }),
  },

  // ── OpenCode ───────────────────────────────────────────────────────────────
  {
    id: "opencode",
    label: "OpenCode CLI",
    configPath: join(HOME, ".opencode", "config.json"),
    detect: () => existsSync(join(HOME, ".opencode", "config.json")),
    // OpenCode uses `mcp` key with `{ type: "local", command: [...], enabled: true }` format
    readServers: (cfg) => cfg.mcp ?? {},
    writeServers: (cfg, servers) => { cfg.mcp = servers; },
    entryFormat: () => ({
      type: "local",
      command: ["bun", MCP_SERVER_PATH],
      enabled: true,
    }),
  },

  // ── Kilocode CLI ───────────────────────────────────────────────────────────
  {
    id: "kilocode",
    label: "Kilocode CLI",
    configPath: join(HOME, ".kilocode", "cli", "global", "settings", "mcp_settings.json"),
    detect: () => existsSync(join(HOME, ".kilocode", "cli", "global", "settings", "mcp_settings.json")),
    readServers: (cfg) => cfg.mcpServers ?? {},
    writeServers: (cfg, servers) => { cfg.mcpServers = servers; },
    entryFormat: () => ({
      command: "bun",
      args: [MCP_SERVER_PATH],
      disabled: false,
      alwaysAllow: [],
    }),
  },

  // ── Antigravity IDE ────────────────────────────────────────────────────────
  // Antigravity loads MCP from its user settings — we place a project-level
  // config at TERMINAL/.antigravity/mcp.json as the canonical location
  // (the setup wizard will instruct the user to point Antigravity to it)
  {
    id: "antigravity",
    label: "Antigravity IDE",
    configPath: join(TERMINAL_ROOT, ".antigravity", "mcp.json"),
    detect: () => true, // always generate — user points Antigravity to this file
    readServers: (cfg) => cfg.mcpServers ?? {},
    writeServers: (cfg, servers) => { cfg.mcpServers = servers; },
    entryFormat: () => ({
      command: "bun",
      args: [MCP_SERVER_PATH],
    }),
  },
];

// ── Core Functions (exported for setup wizard) ───────────────────────────────

export interface RegistrationResult {
  harness: string;
  label: string;
  status: "registered" | "already_registered" | "skipped" | "error";
  configPath: string;
  message?: string;
}

/** Detect which harnesses are installed on this machine. */
export function detectHarnesses(filter?: string[]): HarnessManifest[] {
  return HARNESS_MANIFEST.filter((h) => {
    if (filter && !filter.includes(h.id)) return false;
    return h.detect();
  });
}

/** Read a JSON config file, returning {} if it doesn't exist or is invalid. */
function readConfig(path: string): any {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Write a JSON config file, creating parent dirs as needed. */
function writeConfig(path: string, data: any): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** Register PMM MCP in a single harness config. */
export function registerHarness(
  harness: HarnessManifest,
  opts: { dryRun?: boolean; force?: boolean } = {},
): RegistrationResult {
  const base: Omit<RegistrationResult, "status" | "message"> = {
    harness: harness.id,
    label: harness.label,
    configPath: harness.configPath,
  };

  try {
    const config = readConfig(harness.configPath);
    const servers = harness.readServers(config);

    if (servers["pmm"] && !opts.force) {
      return { ...base, status: "already_registered", message: "pmm already present" };
    }

    const entry = harness.entryFormat();

    if (opts.dryRun) {
      return {
        ...base,
        status: "registered",
        message: `[dry-run] would add "pmm" entry → ${harness.configPath}`,
      };
    }

    servers["pmm"] = entry;
    harness.writeServers(config, servers);
    writeConfig(harness.configPath, config);

    return { ...base, status: "registered", message: `Added "pmm" to ${harness.configPath}` };
  } catch (err) {
    return { ...base, status: "error", message: String(err) };
  }
}

/** Check current registration status for all harnesses (no writes). */
export function statusCheck(): Array<{
  harness: string;
  label: string;
  installed: boolean;
  registered: boolean;
  configPath: string;
}> {
  return HARNESS_MANIFEST.map((h) => {
    const installed = h.detect();
    let registered = false;
    if (installed) {
      try {
        const config = readConfig(h.configPath);
        const servers = h.readServers(config);
        registered = "pmm" in servers;
      } catch { /* */ }
    }
    return { harness: h.id, label: h.label, installed, registered, configPath: h.configPath };
  });
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isStatus = args.includes("--status");
const isForce = args.includes("--force");

const harnessFilter = args
  .find((a) => a.startsWith("--harness=") || (!a.startsWith("--") && HARNESS_MANIFEST.some((h) => a.includes(h.id))))
  ?.replace("--harness=", "")
  .split(",")
  .map((s) => s.trim());

// ── --status ─────────────────────────────────────────────────────────────────
if (isStatus) {
  const statuses = statusCheck();
  console.log("\n╔══ PMM MCP Registration Status ══╗");
  for (const s of statuses) {
    const installed = s.installed ? "✓ installed" : "✗ not found ";
    const registered = s.registered ? "✓ pmm registered" : "✗ not registered";
    console.log(`  ${s.label.padEnd(16)} │ ${installed} │ ${registered}`);
  }
  console.log("╚════════════════════════════════╝\n");
  process.exit(0);
}

// ── Register ──────────────────────────────────────────────────────────────────
const detected = detectHarnesses(harnessFilter);

if (detected.length === 0) {
  console.log("[cns-mcp] No harnesses detected. Run with --status to diagnose.");
  process.exit(1);
}

console.log(`\n[cns-mcp] Registering PMM MCP server${isDryRun ? " (dry-run)" : ""}...`);
console.log(`          Server: ${MCP_SERVER_PATH}\n`);

const results: RegistrationResult[] = [];
for (const harness of detected) {
  const result = registerHarness(harness, { dryRun: isDryRun, force: isForce });
  results.push(result);

  const icon =
    result.status === "registered" ? "✓" :
    result.status === "already_registered" ? "→" :
    result.status === "skipped" ? "·" : "✗";

  console.log(`  ${icon} ${result.label.padEnd(16)} ${result.message ?? ""}`);
}

const registered = results.filter((r) => r.status === "registered").length;
const already = results.filter((r) => r.status === "already_registered").length;
const errors = results.filter((r) => r.status === "error");

console.log(`\n  ${registered} registered, ${already} already set up, ${errors.length} errors`);

if (errors.length > 0) {
  for (const e of errors) console.log(`  ✗ ${e.label}: ${e.message}`);
}

if (registered > 0 && !isDryRun) {
  console.log("\n  ⚠ Restart your harness(es) for MCP changes to take effect.\n");
}
