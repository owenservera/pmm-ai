#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
/**
 * PMM Memory Bridge -- claude-mem integration
 * =============================================
 * Bridges PMM state into claude-mem observations for cross-session continuity.
 * Used by pmm.ts (Task 3) and directly via CLI.
 *
 * Usage: bun scripts/pmm-mem-bridge.ts <command> [options]
 *   search <query> [--project X] [--limit N]    FTS5 search observations
 *   recent --project X [--limit N]              Recent observations by project
 *   inject                                      Inject observation from stdin JSON
 *   context --project X                         Full context for a project
 *   sync --project X                            Sync PMM state into observation
 *   status                                      Bridge status
 */
import { MEM_DB_PATH, openDb, openMemDb, queryOne } from "../src/db";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ObservationRow {
  id: number;
  title: string;
  subtitle: string | null;
  narrative: string;
  type: string;
  project: string;
  created_at: string;
  metadata: string | null;
  created_at_epoch?: number;
}

interface SessionSummaryRow {
  id: number;
  request: string;
  investigated: string;
  learned: string;
  completed: string;
  next_steps: string;
  files_read: string;
  files_edited: string;
  notes: string;
  created_at: string;
  created_at_epoch: number;
}

interface StructuredObservation {
  type:
    | "session_capsule"
    | "milestone_change"
    | "decision_record"
    | "health_change"
    | "feature_progress"
    | "oracle_insight";
  project: string;
  title: string;
  narrative: string;
  metadata: Record<string, unknown>;
}

// ── MemBridge Class ─────────────────────────────────────────────────────────────

class MemBridge {
  private db: Database;

  constructor() {
    this.db = openMemDb();
  }

  close(): void {
    this.db.close();
  }

  /**
   * FTS5 full-text search across observations.
   * Joins observations_fts with observations on rowid.
   * Returns matching rows with id, title, subtitle, narrative, type,
   * project, created_at, metadata. Handles errors gracefully (returns []).
   */
  search(
    query: string,
    opts?: { project?: string; limit?: number; since?: Date },
  ): ObservationRow[] {
    try {
      let sql = `SELECT o.id, o.title, o.subtitle, o.narrative, o.type, o.project, o.created_at, o.metadata
FROM observations_fts fts
JOIN observations o ON fts.rowid = o.id
WHERE observations_fts MATCH ?`;
      const params: any[] = [query];

      if (opts?.project) {
        sql += " AND o.project = ?";
        params.push(opts.project);
      }

      if (opts?.since) {
        sql += " AND o.created_at_epoch >= ?";
        params.push(opts.since.getTime());
      }

      sql += " ORDER BY rank LIMIT ?";
      params.push(opts?.limit ?? 20);

      return this.db.query(sql).all(...params) as ObservationRow[];
    } catch (e) {
      console.error("search failed:", e);
      return [];
    }
  }

  /**
   * Recent observations by project, excluding internal types.
   */
  recent(project: string, limit: number = 20): ObservationRow[] {
    try {
      return this.db
        .query(
          `SELECT id, title, subtitle, narrative, type, project, created_at, metadata, created_at_epoch
FROM observations
WHERE project = ? AND type NOT LIKE 'internal_%'
ORDER BY created_at_epoch DESC
LIMIT ?`,
        )
        .all(project, limit) as ObservationRow[];
    } catch (e) {
      console.error("recent failed:", e);
      return [];
    }
  }

  /**
   * Observations with non-null metadata (PMM-specific).
   */
  pmmObservations(project?: string, limit: number = 50): ObservationRow[] {
    try {
      let sql = `SELECT id, title, subtitle, narrative, type, project, created_at, metadata, created_at_epoch
FROM observations
WHERE metadata IS NOT NULL AND metadata != ''`;
      const params: any[] = [];

      if (project) {
        sql += " AND project = ?";
        params.push(project);
      }

      sql += " ORDER BY created_at_epoch DESC LIMIT ?";
      params.push(limit);

      return this.db.query(sql).all(...params) as ObservationRow[];
    } catch (e) {
      console.error("pmmObservations failed:", e);
      return [];
    }
  }

  /**
   * Recent session summaries for a project.
   */
  sessionSummaries(project: string, limit: number = 5): SessionSummaryRow[] {
    try {
      return this.db
        .query(
          `SELECT id, request, investigated, learned, completed, next_steps, files_read, files_edited, notes, created_at, created_at_epoch
FROM session_summaries
WHERE project = ?
ORDER BY created_at_epoch DESC
LIMIT ?`,
        )
        .all(project, limit) as SessionSummaryRow[];
    } catch (e) {
      console.error("sessionSummaries failed:", e);
      return [];
    }
  }

  /**
   * Inject a structured observation into claude-mem.
   * Required fields: project, type, title.
   * Returns true on success, false on validation failure or error.
   */
  inject(payload: StructuredObservation): boolean {
    try {
      if (!payload.project || !payload.type || !payload.title) {
        console.error("Validation failed: project, type, and title are required");
        return false;
      }

      const sessionId = `pmm-bridge-${randomBytes(8).toString("hex")}`;
      const type = `pmm_${payload.type}`;
      const metadata = JSON.stringify(payload.metadata || {});
      const now = new Date();
      const createdAt = now.toISOString().replace("T", " ").slice(0, 19);
      const epoch = Math.floor(now.getTime() / 1000);

      this.db.run(
        `INSERT INTO observations (memory_session_id, project, type, title, subtitle, narrative, facts, metadata, created_at, created_at_epoch)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          payload.project,
          type,
          payload.title,
          null,
          payload.narrative || "",
          null,
          metadata,
          createdAt,
          epoch,
        ],
      );

      return true;
    } catch (e) {
      console.error("Inject failed:", e);
      return false;
    }
  }

  /**
   * Sync PMM project state into a claude-mem observation.
   * Queries projects, milestones, decisions, capsules, features, and alerts
   * from the PMM database, builds a narrative string, and injects it.
   */
  syncState(project: string): boolean {
    let pmmDb: Database | null = null;
    try {
      pmmDb = openDb();

      // Project info
      const proj = queryOne(pmmDb, "SELECT * FROM projects WHERE name = ?", [project]) as any;
      if (!proj) {
        console.error(`Project "${project}" not found in PMM DB`);
        return false;
      }

      // Milestones
      const milestones = pmmDb
        .query(
          `SELECT name, due, status FROM milestones WHERE project_id = ? ORDER BY created_at DESC LIMIT 5`,
        )
        .all(proj.id) as any[];

      // Decisions
      const decisions = pmmDb
        .query(
          `SELECT question, decision, created_at FROM decisions WHERE project_id = ? AND status = 'decided' ORDER BY created_at DESC LIMIT 5`,
        )
        .all(proj.id) as any[];

      // Latest session capsule
      const capsule = queryOne(
        pmmDb,
        `SELECT summary, created_at FROM session_capsules WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
        [proj.id],
      ) as any;

      // Active alerts
      const alerts = pmmDb
        .query(`SELECT COUNT(*) as count FROM alerts WHERE project_id = ? AND resolved_at IS NULL`)
        .get(proj.id) as any;
      const alertCount = alerts?.count ?? 0;

      // Build narrative string
      const parts: string[] = [];
      parts.push(`Project: ${project}`);
      parts.push(`Phase: ${proj.phase || "unknown"}`);
      parts.push(`Health: ${proj.health || "unknown"}`);

      if (milestones.length) {
        const msParts = milestones.map(
          (m: any) => `${m.name} (${m.status || "pending"})${m.due ? ` due ${m.due}` : ""}`,
        );
        parts.push(`Milestones: ${msParts.join(", ")}`);
      }

      if (decisions.length) {
        const decParts = decisions.map((d: any) => `${d.question} => ${d.decision}`);
        parts.push(`Recent decisions: ${decParts.join("; ")}`);
      }

      if (capsule) {
        parts.push(`Last session: ${capsule.summary} (${capsule.created_at})`);
      }

      parts.push(`Active alerts: ${alertCount}`);

      const narrative = parts.join("\n");

      // Inject the observation
      return this.inject({
        type: "session_capsule",
        project,
        title: `State sync for ${project}`,
        narrative,
        metadata: {
          phase: proj.phase,
          health: proj.health,
          milestoneCount: milestones.length,
          decisionCount: decisions.length,
          alertCount,
          syncedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.error("syncState failed:", e);
      return false;
    } finally {
      if (pmmDb) pmmDb.close();
    }
  }

  /**
   * Bridge status: DB accessibility, observation count, and path.
   */
  status(): { accessible: boolean; observationCount: number; dbPath: string } {
    try {
      const count = this.db.query("SELECT COUNT(*) as c FROM observations").get() as any;
      return {
        accessible: true,
        observationCount: count?.c ?? 0,
        dbPath: MEM_DB_PATH,
      };
    } catch (e) {
      console.error("status failed:", e);
      return { accessible: false, observationCount: 0, dbPath: MEM_DB_PATH };
    }
  }
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const bridge = new MemBridge();

  try {
    const cmd = args[0];

    if (!cmd) {
      console.log(`Usage: bun scripts/pmm-mem-bridge.ts <command> [options]

Commands:
  search <query> [--project X] [--limit N]   FTS5 search observations
  recent --project X [--limit N]             Recent observations by project
  inject                                     Inject observation from stdin JSON
  context --project X                        Full context for a project
  sync --project X                           Sync PMM state into observation
  status                                     Bridge status`);
      return;
    }

    if (cmd === "search") {
      const query = args[1];
      if (!query) {
        console.error("Error: search query required");
        process.exit(1);
      }
      let project: string | undefined;
      let limit = 10;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--project" && args[i + 1]) project = args[++i] as string;
        else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i] as string, 10);
      }
      const results = bridge.search(query, { project, limit });
      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === "recent") {
      let project: string | undefined;
      let limit = 10;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--project" && args[i + 1]) project = args[++i] as string;
        else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i] as string, 10);
      }
      if (!project) {
        console.error("Error: --project is required");
        process.exit(1);
      }
      const results = bridge.recent(project, limit);
      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === "inject") {
      let body = "";
      for await (const chunk of Bun.stdin.stream()) {
        body += new TextDecoder().decode(chunk);
      }
      const payload = JSON.parse(body) as StructuredObservation;
      const ok = bridge.inject(payload);
      if (!ok) {
        console.error("Inject failed");
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true }));
    } else if (cmd === "context") {
      let project: string | undefined;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--project" && args[i + 1]) project = args[++i] as string;
      }
      if (!project) {
        console.error("Error: --project is required");
        process.exit(1);
      }
      const recentObs = bridge.recent(project, 10);
      console.log(JSON.stringify({ project, recent_observations: recentObs }, null, 2));
    } else if (cmd === "sync") {
      let project: string | undefined;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--project" && args[i + 1]) project = args[++i] as string;
      }
      if (!project) {
        console.error("Error: --project is required");
        process.exit(1);
      }
      const ok = bridge.syncState(project);
      console.log(JSON.stringify({ ok, project }));
    } else if (cmd === "status") {
      const s = bridge.status();
      console.log(JSON.stringify(s, null, 2));
    } else {
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
    }
  } finally {
    bridge.close();
  }
}

main().catch((err) => {
  console.error("pmm-mem-bridge error:", err);
  process.exit(1);
});
