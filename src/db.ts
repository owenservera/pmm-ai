/**
 * PMM Shared DB Module
 * ====================
 * Single source of truth for all PMM database operations.
 * Used by both CLI (scripts/cli.ts) and API (src/automation-api.ts).
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

export const DB_PATH = join(import.meta.dir, "..", "data", "pmm.db");

export const MEM_DB_PATH = join(homedir(), ".claude-mem", "claude-mem.db");

export function openDb(): Database {
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

export function openMemDb(): Database {
  const db = new Database(MEM_DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  // claude-mem uses read_committed for its worker — match it
  db.exec("PRAGMA read_uncommitted = false;");
  return db;
}

export function queryAll(db: Database, sql: string, params: any[] = []): any[] {
  return db.query(sql).all(...params);
}

export function queryOne(db: Database, sql: string, params: any[] = []): any | null {
  return db.query(sql).get(...params);
}

export function run(db: Database, sql: string, params: any[] = []): void {
  db.run(sql, params);
}

export function getProjectId(db: Database, name: string): number | null {
  const row = queryOne(db, "SELECT id FROM projects WHERE name = ?", [name]) as any;
  return row ? row.id : null;
}

export function getProjectIdOrFail(db: Database, name: string): number {
  const id = getProjectId(db, name);
  if (!id)
    throw new Error(
      `Project "${name}" not found. Register it first: bun scripts/pmm.ts project register ${name}`,
    );
  return id;
}

/**
 * Generate a unique harness session ID for cross-harness tracking.
 * Format: <harness>-<16 hex chars>
 * Example: "antigravity-fe2f9a0dee0cc9a6"
 */
export function generateSessionId(harness: string): string {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return `${harness}-${randomBytes(8).toString("hex")}`;
}
