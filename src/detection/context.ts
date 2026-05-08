/**
 * PMM ContextSnapshot Provider
 * =============================
 * Reads the PMM SQLite database and returns a structured ContextSnapshot
 * for the resolver's context_boost layer. 5-second cache TTL.
 */

import { openDb, queryAll, queryOne } from "../db";

export interface ContextSnapshot {
  active_project: {
    name: string;
    phase: string;
    health: string;
    priority: string;
    last_session: string | null;
  };
  recent_actions: Array<{
    action: string;
    timestamp: string;
  }>;
  portfolio_summary: {
    total_projects: number;
    healthy_count: number;
    attention_count: number;
    blocked_count: number;
    stale_count: number;
  };
  process?: {
    active_methodologies: string[];
    detected_phase: string;
    artifact_count: number;
    gaps: Array<{ type: string; auto_fixable: boolean }>;
  };
  generated_at: string;
}

const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  snapshot: ContextSnapshot;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

export function clearContextCache(): void {
  cache = null;
}

export function buildContextSnapshot(projectName: string): ContextSnapshot {
  const now = Date.now();

  if (cache && now < cache.expiresAt) {
    return cache.snapshot;
  }

  const db = openDb();

  try {
    // -- Active project -------------------------------------------------------
    const project = queryOne(
      db,
      "SELECT name, phase, health, priority, last_session FROM projects WHERE name = ?",
      [projectName],
    ) as {
      name: string;
      phase: string;
      health: string;
      priority: string;
      last_session: string | null;
    } | null;

    const active_project = project ?? {
      name: "unknown",
      phase: "unknown",
      health: "unknown",
      priority: "unknown",
      last_session: null,
    };

    // -- Recent actions (last 5 sessions for this project) --------------------
    const sessions = queryAll(
      db,
      `SELECT s.summary, s.ended_at
       FROM sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE p.name = ? AND s.ended_at IS NOT NULL
       ORDER BY s.ended_at DESC
       LIMIT 5`,
      [projectName],
    ) as Array<{ summary: string | null; ended_at: string }>;

    const recent_actions = sessions.map((s) => ({
      action: s.summary ?? "unknown",
      timestamp: s.ended_at,
    }));

    // -- Portfolio summary ----------------------------------------------------
    const countActive = (sql: string): number => {
      const row = queryOne(db, sql) as { c: number };
      return row.c;
    };

    const total_projects = countActive(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'active'",
    );
    const healthy_count = countActive(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'active' AND health = 'healthy'",
    );
    const attention_count = countActive(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'active' AND health = 'attention'",
    );
    const blocked_count = countActive(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'active' AND health = 'blocked'",
    );
    const stale_count = countActive(
      "SELECT COUNT(*) as c FROM projects WHERE status = 'active' AND (last_session IS NULL OR julianday('now') - julianday(last_session) > 14)",
    );

    // -- Process state (lightweight — full filesystem scan on demand) --------
    let processState: ContextSnapshot["process"] | undefined;
    try {
      const methodRows = queryAll(
        db,
        "SELECT name FROM methodologies WHERE enabled = 1 ORDER BY priority DESC",
      ) as Array<{ name: string }>;
      if (methodRows.length > 0) {
        processState = {
          active_methodologies: methodRows.map((r: { name: string }) => r.name),
          detected_phase: "unknown",
          artifact_count: 0,
          gaps: [],
        };
      }
    } catch {
      // methodologies table may not exist yet
    }

    const snapshot: ContextSnapshot = {
      active_project,
      recent_actions,
      portfolio_summary: {
        total_projects,
        healthy_count,
        attention_count,
        blocked_count,
        stale_count,
      },
      process: processState,
      generated_at: new Date().toISOString(),
    };

    cache = { snapshot, expiresAt: now + CACHE_TTL_MS };
    return snapshot;
  } finally {
    db.close();
  }
}
