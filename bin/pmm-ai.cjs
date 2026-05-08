#!/usr/bin/env node
/**
 * PMM-AI Bootstrap Shim
 * ======================
 * Runs before the CLI to ensure the environment is ready.
 * 1. Creates ~/.pmm-ai/data/ if missing (so the DB can be created)
 * 2. Spawns bun to execute the TypeScript CLI
 */
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const { resolve, dirname, join } = require("node:path");
const { homedir } = require("node:os");

// Ensure PMM data directory exists before CLI touches the DB
const PPP_DATA = join(homedir(), ".pmm-ai", "data");
if (!existsSync(PPP_DATA)) {
  try { mkdirSync(PPP_DATA, { recursive: true }); } catch {}
}

const args = process.argv.slice(2);
const entry = resolve(dirname(process.argv[1]), "pmm.ts");
const result = spawnSync("bun", ["run", entry, ...args], {
  stdio: "inherit",
  env: { ...process.env, PMM_AI_NPM: "1" },
});
process.exit(result.status ?? 1);
