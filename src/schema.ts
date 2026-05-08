/**
 * PMM Schema — Centralized DDL
 * =============================
 * All CREATE TABLE IF NOT EXISTS and idempotent ALTER TABLE patches.
 * Called once at startup by the CLI router and API server.
 *
 * Rust-translatable: this module would become a migration runner.
 */
import type { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  // ── Core tables ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_nodes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id   INTEGER REFERENCES portfolio_nodes(id),
      type        TEXT NOT NULL CHECK(type IN (
                    'product','component','project','module',
                    'workstream','epic','feature','initiative',
                    'roadmap'
                  )),
      name        TEXT NOT NULL,
      description TEXT,
      status      TEXT CHECK(status IN ('active','planned','completed','paused','draft')) DEFAULT 'planned',
      sort_order  INTEGER DEFAULT 0,
      target_date TEXT,
      goals       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── Swarm execution tables ───────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_layers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL REFERENCES projects(id),
      layer_num       INTEGER NOT NULL CHECK(layer_num >= 0),
      name            TEXT NOT NULL,
      description     TEXT,
      topology        TEXT DEFAULT 'hierarchical' CHECK(topology IN ('hierarchical','mesh','star','ring','adaptive','hierarchical-mesh')),
      consensus       TEXT DEFAULT 'L0-authority' CHECK(consensus IN ('L0-authority','raft','byzantine','gossip','crdt','quorum')),
      checkpoint_interval INTEGER DEFAULT 5,
      max_tracks      INTEGER DEFAULT 3,
      min_model_tier  TEXT DEFAULT 'sonnet',
      sort_order      INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, layer_num)
    );

    CREATE TABLE IF NOT EXISTS agent_tracks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      layer_id        INTEGER NOT NULL REFERENCES agent_layers(id),
      track_letter    TEXT NOT NULL,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL CHECK(role IN ('architect','designer','engineer','reviewer','researcher','implementer')),
      raci            TEXT NOT NULL DEFAULT 'R',
      assigned_agent  TEXT,
      assigned_model  TEXT DEFAULT 'sonnet',
      assigned_harness TEXT DEFAULT 'claude-code',
      isolation_mode  TEXT DEFAULT 'file-domain' CHECK(isolation_mode IN ('file-domain','worktree','none')),
      file_domain     TEXT,
      is_active       INTEGER DEFAULT 1,
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(layer_id, track_letter)
    );

    CREATE TABLE IF NOT EXISTS swarm_tasks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id        INTEGER NOT NULL REFERENCES projects(id),
      feature_id        INTEGER REFERENCES features(id),
      milestone_id      INTEGER REFERENCES milestones(id),
      layer_num         INTEGER NOT NULL,
      track_letter      TEXT,
      routing_code      INTEGER DEFAULT 3 CHECK(routing_code BETWEEN 0 AND 99),
      name              TEXT NOT NULL,
      description       TEXT,
      acceptance_criteria TEXT,
      dependencies      TEXT,
      status            TEXT DEFAULT 'pending' CHECK(status IN ('pending','claimed','in_progress','review','completed','rejected','escalated')),
      claimed_by        INTEGER REFERENCES agent_workers(id),
      claimed_at        TEXT,
      started_at        TEXT,
      submitted_at      TEXT,
      completed_at      TEXT,
      evidence          TEXT,
      review_comment    TEXT,
      escalated_to      INTEGER,
      escalation_reason TEXT,
      raci_responsible  TEXT,
      raci_accountable  TEXT,
      raci_consulted    TEXT,
      raci_informed     TEXT,
      estimated_tokens  INTEGER,
      actual_tokens     INTEGER,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS swarm_audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES projects(id),
      task_id       INTEGER NOT NULL REFERENCES swarm_tasks(id),
      worker_id     INTEGER REFERENCES agent_workers(id),
      action        TEXT NOT NULL CHECK(action IN ('checkout','checkin','release','approve','reject','escalate','resolve','status_update','artifact_share')),
      layer_num     INTEGER,
      track_letter  TEXT,
      details       TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS swarm_escalations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES projects(id),
      task_id       INTEGER NOT NULL REFERENCES swarm_tasks(id),
      from_layer    INTEGER NOT NULL,
      to_layer      INTEGER NOT NULL,
      reason        TEXT NOT NULL,
      severity      TEXT DEFAULT 'P2' CHECK(severity IN ('P0','P1','P2')),
      status        TEXT DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
      resolved_by   INTEGER REFERENCES agent_workers(id),
      resolution    TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      resolved_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS swarm_handoffs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES projects(id),
      manifest      TEXT NOT NULL,
      format_version TEXT DEFAULT '1.0',
      layers_count  INTEGER,
      tasks_count   INTEGER,
      routing_codes_used TEXT,
      export_path   TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS background_workers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES projects(id),
      name          TEXT NOT NULL,
      agent_type    TEXT NOT NULL,
      model         TEXT DEFAULT 'haiku',
      description   TEXT,
      schedule_interval INTEGER NOT NULL,
      priority      TEXT DEFAULT 'normal' CHECK(priority IN ('critical','high','normal','low')),
      is_enabled    INTEGER DEFAULT 1,
      last_run_at   TEXT,
      next_run_at   TEXT,
      run_count     INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── CNS: cross-harness session tracking ──────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_sessions (
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
    CREATE INDEX IF NOT EXISTS idx_harness_sessions_project ON harness_sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_harness_sessions_harness ON harness_sessions(harness);
    CREATE INDEX IF NOT EXISTS idx_harness_sessions_started ON harness_sessions(started_at);
  `);

  // ── Idempotent column patches ────────────────────────
  applyPatches(db);
}

function applyPatches(db: Database): void {
  // node_id on milestones
  try { db.exec(`ALTER TABLE milestones ADD COLUMN node_id INTEGER REFERENCES portfolio_nodes(id);`); } catch (_) {}

  // PMM v4.1 — task enrichment columns
  try { db.exec(`ALTER TABLE atomic_tasks ADD COLUMN session_id INTEGER REFERENCES sessions(id);`); } catch (_) {}
  try { db.exec(`ALTER TABLE atomic_tasks ADD COLUMN methods TEXT;`); } catch (_) {}
  try { db.exec(`ALTER TABLE atomic_tasks ADD COLUMN evidence TEXT;`); } catch (_) {}
  try { db.exec(`ALTER TABLE atomic_tasks ADD COLUMN closed_at TEXT;`); } catch (_) {}

  // CNS v1.0 — cross-harness tracking columns
  try { db.exec(`ALTER TABLE agent_workers ADD COLUMN harness TEXT DEFAULT 'claude-code';`); } catch (_) {}
  try { db.exec(`ALTER TABLE sessions ADD COLUMN harness TEXT DEFAULT 'claude-code';`); } catch (_) {}
  try { db.exec(`ALTER TABLE sessions ADD COLUMN model_used TEXT;`); } catch (_) {}

  // PMM v4.2 — swarm columns on agent_workers
  try { db.exec(`ALTER TABLE agent_workers ADD COLUMN swarm_task_id INTEGER REFERENCES swarm_tasks(id);`); } catch (_) {}
  try { db.exec(`ALTER TABLE agent_workers ADD COLUMN layer_num INTEGER;`); } catch (_) {}
  try { db.exec(`ALTER TABLE agent_workers ADD COLUMN track_letter TEXT;`); } catch (_) {}
  try { db.exec(`ALTER TABLE agent_workers ADD COLUMN routing_code INTEGER;`); } catch (_) {}
  try { db.exec(`ALTER TABLE agent_workers ADD COLUMN handoff_version TEXT;`); } catch (_) {}
}
