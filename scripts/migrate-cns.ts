/**
 * CNS Migration — Harness Session Registry
 * =========================================
 * Adds cross-harness session tracking infrastructure:
 *   - harness_sessions table (full session lifecycle per AI tool)
 *   - agent_workers.harness column (which harness spawned this worker)
 *   - sessions.harness + sessions.model_used columns
 *
 * Version: cns-1.0
 * Usage:   bun scripts/migrate-cns-harness.ts
 * Idempotent: safe to run multiple times.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { copyFileSync, existsSync } from "node:fs";

const DB_PATH = join(import.meta.dir, "..", "data", "pmm.db");
const BACKUP_PATH = join(import.meta.dir, "..", "data", "pmm.db.cns-pre.bak");

// ── Pre-flight backup ──────────────────────────────────────
if (!existsSync(BACKUP_PATH)) {
  copyFileSync(DB_PATH, BACKUP_PATH);
  console.log(`[cns] Backup saved → PMM/pmm.db.cns-pre.bak`);
} else {
  console.log(`[cns] Backup already exists, skipping`);
}

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");
db.exec("PRAGMA foreign_keys=ON;");

let step = 0;
function log(msg: string) {
  console.log(`[cns:${++step}] ${msg}`);
}

function addColumnIfMissing(table: string, column: string, definition: string): boolean {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// STEP 1: harness_sessions table
// ═══════════════════════════════════════════════════════════

log("Creating harness_sessions table...");

const tableExists = db
  .query("SELECT name FROM sqlite_master WHERE type='table' AND name='harness_sessions'")
  .get() as any;

if (!tableExists) {
  db.exec(`
    CREATE TABLE harness_sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      harness       TEXT NOT NULL CHECK(harness IN (
                      'claude-code','antigravity','gemini-cli',
                      'opencode','cursor','windsurf','custom'
                    )),
      session_id    TEXT NOT NULL UNIQUE,
      project_id    INTEGER REFERENCES projects(id),
      started_at    TEXT DEFAULT (datetime('now')),
      ended_at      TEXT,
      summary       TEXT,
      files_read    TEXT,
      files_edited  TEXT,
      model_used    TEXT,
      tokens_used   INTEGER
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_harness_sessions_project ON harness_sessions(project_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_harness_sessions_harness ON harness_sessions(harness);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_harness_sessions_started ON harness_sessions(started_at);");
  console.log("  ✓ harness_sessions table created with 3 indexes");
} else {
  console.log("  ✓ harness_sessions already exists, skipping");
}

// ═══════════════════════════════════════════════════════════
// STEP 2: agent_workers — add harness tracking column
// ═══════════════════════════════════════════════════════════

log("Patching agent_workers table...");

// harness_name already exists from v4 migration — add the typed harness column
const addedHarness = addColumnIfMissing(
  "agent_workers",
  "harness",
  "TEXT DEFAULT 'claude-code'",
);

// Backfill from harness_name if it has data
if (addedHarness) {
  db.exec(`
    UPDATE agent_workers
    SET harness = harness_name
    WHERE harness_name IS NOT NULL
      AND harness_name IN ('claude-code','antigravity','gemini-cli','opencode','cursor','windsurf','custom');
  `);
  const backfilled = (db.query("SELECT COUNT(*) as c FROM agent_workers WHERE harness != 'claude-code'").get() as any).c;
  console.log(`  ✓ Added harness column, backfilled ${backfilled} rows from harness_name`);
} else {
  console.log("  ✓ harness column already exists");
}

// ═══════════════════════════════════════════════════════════
// STEP 3: sessions — add harness + model_used columns
// ═══════════════════════════════════════════════════════════

log("Patching sessions table...");

const addedSessionHarness = addColumnIfMissing(
  "sessions",
  "harness",
  "TEXT DEFAULT 'claude-code'",
);
const addedModelUsed = addColumnIfMissing(
  "sessions",
  "model_used",
  "TEXT",
);

const patches: string[] = [];
if (addedSessionHarness) patches.push("harness");
if (addedModelUsed) patches.push("model_used");

if (patches.length > 0) {
  console.log(`  ✓ Added columns to sessions: ${patches.join(", ")}`);
} else {
  console.log("  ✓ sessions already patched");
}

// ═══════════════════════════════════════════════════════════
// STEP 4: Record schema version
// ═══════════════════════════════════════════════════════════

log("Recording schema version...");

// Ensure schema_versions exists (should from v4, but be safe)
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    version     TEXT NOT NULL UNIQUE,
    description TEXT,
    filename    TEXT,
    applied_at  TEXT DEFAULT (datetime('now'))
  );
`);

const alreadyRecorded = db
  .query("SELECT id FROM schema_versions WHERE version = 'cns-1.0'")
  .get() as any;

if (!alreadyRecorded) {
  db.run(
    "INSERT INTO schema_versions (version, description, filename) VALUES (?, ?, ?)",
    [
      "cns-1.0",
      "CNS harness_sessions table + harness/model_used columns on agent_workers and sessions",
      "migrate-cns-harness.ts",
    ],
  );
  console.log("  ✓ Recorded schema version cns-1.0");
} else {
  console.log("  ✓ Version cns-1.0 already recorded");
}

// ═══════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════

log("Validating...");

const integrity = (db.query("PRAGMA integrity_check").get() as any).integrity_check;
console.log(`  Integrity check: ${integrity}`);

// Verify harness_sessions columns
const hs = db.query("PRAGMA table_info(harness_sessions)").all() as any[];
console.log(`  harness_sessions columns: ${hs.map((c: any) => c.name).join(", ")}`);

// Verify sessions patches
const sc = db.query("PRAGMA table_info(sessions)").all() as any[];
const hasHarness = sc.some((c: any) => c.name === "harness");
const hasModel = sc.some((c: any) => c.name === "model_used");
console.log(`  sessions.harness: ${hasHarness ? "✓" : "✗"} | sessions.model_used: ${hasModel ? "✓" : "✗"}`);

// Verify agent_workers patch
const aw = db.query("PRAGMA table_info(agent_workers)").all() as any[];
const hasWorkerHarness = aw.some((c: any) => c.name === "harness");
console.log(`  agent_workers.harness: ${hasWorkerHarness ? "✓" : "✗"}`);

// Count indexes on harness_sessions
const hsIndexes = db
  .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='harness_sessions'")
  .all() as any[];
console.log(`  harness_sessions indexes: ${hsIndexes.map((i: any) => i.name).join(", ")}`);

const tableCount = (db.query("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as any).c;

db.close();

// ── Summary ──────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════╗");
console.log("║   CNS Migration cns-1.0 Complete            ║");
console.log("╠══════════════════════════════════════════════╣");
console.log(`║  harness_sessions:  ${integrity === "ok" ? "✓ created" : "✗ ERROR   "}               ║`);
console.log(`║  sessions patch:    ${hasHarness && hasModel ? "✓ applied" : "✗ partial "}               ║`);
console.log(`║  agent_workers:     ${hasWorkerHarness ? "✓ patched" : "✗ ERROR   "}               ║`);
console.log(`║  Total tables:      ${String(tableCount).padEnd(4)}                          ║`);
console.log(`║  DB: PMM/pmm.db                              ║`);
console.log("╚══════════════════════════════════════════════╝");
