#!/usr/bin/env node
// npm bin shim — spawns bun to run the actual TypeScript entry point.
// Portable across Windows, macOS, and Linux.
const { spawnSync } = require("node:child_process");
const { resolve, dirname } = require("node:path");
const args = process.argv.slice(2);
const entry = resolve(dirname(process.argv[1]), "pmm.ts");
const result = spawnSync("bun", ["run", entry, ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
