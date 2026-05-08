/**
 * PMM-AI Database Module
 * ======================
 * Default DB at ~/.pmm-ai/data/pmm.db — survives npm cache clears.
 * Override with PMM_DB_PATH env var for testing/CI/custom locations.
 * Auto-creates directory and schema on first access.
 * Upgrade-safe: CREATE TABLE IF NOT EXISTS — never drops existing data.
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { initSchema } from "./schema";

// ─── Path Resolution ───────────────────────────────────────────────────

const PPP_DIR = join(homedir(), ".pmm-ai");
const PPP_DATA = join(PPP_DIR, "data");
const DEFAULT_DB_PATH = join(PPP_DATA, "pmm.db");

/** Resolve the DB path: env var override or default. */
export function getDbPath(): string {
  const envPath = process.env.PMM_DB_PATH;
  if (envPath) {
    // Support ~/ expansion
    if (envPath.startsWith("~")) {
      return join(homedir(), envPath.slice(1));
    }
    // Unix absolute path
    if (envPath.startsWith("/")) {
      return envPath;
    }
    // Windows absolute path (C:\... or C:/...)
    if (/^[A-Za-z]:[/\\]/.test(envPath)) {
      return envPath;
    }
    // Relative path → resolve from CWD
    return join(process.cwd(), envPath);
  }
  return DEFAULT_DB_PATH;
}

export const DB_PATH = getDbPath();
export const MEM_DB_PATH = join(homedir(), ".claude-mem", "claude-mem.db");

// ─── Init + Open ────────────────────────────────────────────────────────

let _db: Database | null = null;
let _ensured = false;

/**
 * Ensure the DB directory and file exist with full schema.
 *
 * Upgrade-safe behavior:
 * - If DB file doesn't exist → creates it with full schema (first run)
 * - If DB file exists but _ensured=false → runs initSchema to add any
 *   new tables from upgrades (CREATE TABLE IF NOT EXISTS is idempotent)
 * - If _ensured=true → no-op (already ensured this process)
 *
 * Returns the resolved DB path (respecting PMM_DB_PATH env var).
 */
export function ensureDb(): string {
  const dbPath = getDbPath();
  const dbDir = dirname(dbPath);

  // Always ensure the parent directory exists (works for custom paths too)
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Also ensure default data dir exists (backward compatibility for logs, exports)
  if (dbPath !== DEFAULT_DB_PATH && !existsSync(PPP_DATA)) {
    mkdirSync(PPP_DATA, { recursive: true });
  }

  if (!existsSync(dbPath)) {
    // First run: brand new DB
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA foreign_keys=ON;");
    initSchema(db);
    db.close();
  } else if (!_ensured) {
    // Upgrading: existing DB, add any new tables (idempotent IF NOT EXISTS)
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA foreign_keys=ON;");
    initSchema(db);
    db.close();
  }
  _ensured = true;
  return dbPath;
}

/** Open the global PMM database (auto-creates if missing). */
export function openDb(): Database {
  const dbPath = ensureDb();
  const db = new Database(dbPath);
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
