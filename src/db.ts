/**
 * PMM-AI Database Module
 * ======================
 * Global DB at ~/.pmm-ai/data/pmm.db — survives npm cache clears.
 * Auto-creates directory and schema on first access.
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initSchema } from "./schema";

// ─── Paths ─────────────────────────────────────────────────────────────

const PPP_DIR = join(homedir(), ".pmm-ai");
const PPP_DATA = join(PPP_DIR, "data");

export const DB_PATH = join(PPP_DATA, "pmm.db");
export const MEM_DB_PATH = join(homedir(), ".claude-mem", "claude-mem.db");

// ─── Init + Open ────────────────────────────────────────────────────────

let _db: Database | null = null;
let _ensured = false;

/** Ensure ~/.pmm-ai/data/ exists and DB is initialized with full schema. */
export function ensureDb(): string {
  if (!existsSync(PPP_DATA)) {
    mkdirSync(PPP_DATA, { recursive: true });
  }
  if (!existsSync(DB_PATH)) {
    const db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA foreign_keys=ON;");
    initSchema(db);
    db.close();
  } else if (!_ensured) {
    const db = new Database(DB_PATH);
    initSchema(db);
    db.close();
  }
  _ensured = true;
  return DB_PATH;
}

/** Open the global PMM database (auto-creates if missing). */
export function openDb(): Database {
  ensureDb();
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

/** Get a persistent singleton connection. */
export function getDb(): Database {
  if (!_db) _db = openDb();
  return _db;
}

export function openMemDb(): Database {
  const db = new Database(MEM_DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA read_uncommitted = false;");
  return db;
}

// ─── Query Helpers ──────────────────────────────────────────────────────

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
      `Project "${name}" not found. Register it first: pmm-ai project register ${name}`,
    );
  return id;
}

export function generateSessionId(harness: string): string {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return `${harness}-${randomBytes(8).toString("hex")}`;
}
