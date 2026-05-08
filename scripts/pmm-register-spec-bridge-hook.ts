#!/usr/bin/env bun
/**
 * Spec Bridge Hook Registration
 * ==============================
 * One-time setup: register the pmm-spec-bridge as a PostToolUse hook handler.
 * Run: bun scripts/pmm-register-spec-bridge-hook.ts
 */
import { openDb, queryOne, run } from "../src/db";

const db = openDb();

try {
  // Find TERMINAL project
  const terminal = queryOne(db, "SELECT id FROM projects WHERE name = 'TERMINAL'") as any;
  if (!terminal) {
    console.error("TERMINAL project not found in PMM DB. Skipping hook registration.");
    process.exit(1);
  }
  const terminalId = terminal.id;

  // Find the PostToolUse hook
  const hook = queryOne(
    db,
    "SELECT id FROM hooks WHERE project_id = ? AND event_name = 'PostToolUse'",
    [terminalId],
  ) as any;

  if (!hook) {
    console.error("PostToolUse hook not found for TERMINAL project.");
    process.exit(1);
  }

  // Check if already registered
  const existing = queryOne(
    db,
    "SELECT COUNT(*) as c FROM hook_handlers WHERE hook_id = ? AND command LIKE '%pmm-spec-bridge%'",
    [hook.id],
  ) as any;

  if (existing && existing.c > 0) {
    console.log("[pmm-spec-bridge] Hook handler already registered.");
    process.exit(0);
  }

  // Register the spec-bridge handler with file-write matcher for spec paths
  run(
    db,
    `INSERT INTO hook_handlers (hook_id, handler_order, command, timeout_ms, parallel, matcher)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      hook.id,
      10,
      'bun scripts/pmm-spec-bridge.ts --auto --files "{files}"',
      10000,
      0,
      "file-write:docs/superpowers/specs|file-write:docs/specs|file-write:PMM",
    ],
  );

  console.log("[pmm-spec-bridge] Hook handler registered for PostToolUse.");
  console.log("  Handler order: 10 (runs after biome checks)");
  console.log("  Command: bun scripts/pmm-spec-bridge.ts --auto --files \"{files}\"");
  console.log("  Timeout: 10000ms");
  console.log("  Matcher: file-write:docs/superpowers/specs|file-write:docs/specs|file-write:PMM");
} finally {
  db.close();
}
