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

// Resolve data directory (respects PMM_DB_PATH env var)
let dataDir;
const envDbPath = process.env.PMM_DB_PATH;
if (envDbPath) {
  // Extract the parent directory from the custom DB path
  const resolved = envDbPath.startsWith("~")
    ? join(homedir(), envDbPath.slice(1))
    : envDbPath;
  dataDir = require("node:path").dirname(resolved);
} else {
  dataDir = join(homedir(), ".pmm-ai", "data");
}
if (!existsSync(dataDir)) {
  try { mkdirSync(dataDir, { recursive: true }); } catch {}
}

const args = process.argv.slice(2);
const entry = resolve(dirname(process.argv[1]), "pmm.ts");
const result = spawnSync("bun", ["run", entry, ...args], {
  stdio: "inherit",
  env: { ...process.env, PMM_AI_NPM: "1" },
});
process.exit(result.status ?? 1);
