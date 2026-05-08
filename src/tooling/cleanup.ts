/**
 * Orphan Cleanup — Garbage Collection for PMM-AI
 * ==============================================
 * Detects and optionally removes orphaned records:
 * - Projects with 0 sessions in 30 days
 * - Workers dispatched but never completed (>6hr)
 * - Swarm tasks claimed but never completed
 * - Sessions registered but never closed (>24hr)
 * - Stale eval_runs with no recent activity
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne } from "../db";

export interface CleanupReport {
  orphan_projects: { id: number; name: string; last_activity: string | null }[];
  stuck_workers: { id: number; agent_type: string; status: string; hours_stale: number }[];
  stale_sessions: { id: number; project: string; started: string; hours_open: number }[];
  unclaimed_swarm_tasks: { id: number; name: string; project: string }[];
  total_orphans: number;
  recommendations: string[];
}

export function scan(db: Database, autoFix = false): CleanupReport {
  const report: CleanupReport = {
    orphan_projects: [],
    stuck_workers: [],
    stale_sessions: [],
    unclaimed_swarm_tasks: [],
    total_orphans: 0,
    recommendations: [],
  };

  // 1. Orphan projects: no sessions in 30 days
  const orphanProjects = queryAll(db, `
    SELECT p.id, p.name, MAX(s.started_at) as last_activity
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    WHERE p.status = 'active'
    GROUP BY p.id
    HAVING last_activity IS NULL OR last_activity < datetime('now', '-30 days')
  `) as any[];
  report.orphan_projects = orphanProjects;
  if (orphanProjects.length > 0) {
    report.recommendations.push(`${orphanProjects.length} projects with no sessions in 30 days`);
  }

  // 2. Stuck workers: dispatched but never completed
  const stuckWorkers = queryAll(db, `
    SELECT w.id, w.agent_type, w.status,
           ROUND((julianday('now') - julianday(w.created_at)) * 24, 1) as hours_stale
    FROM agent_workers w
    WHERE w.status IN ('dispatched', 'running')
    AND w.created_at < datetime('now', '-6 hours')
    ORDER BY hours_stale DESC
  `) as any[];
  report.stuck_workers = stuckWorkers;
  if (stuckWorkers.length > 0) {
    report.recommendations.push(`${stuckWorkers.length} workers stuck >6hr — mark as failed or cancelled`);
  }

  // 3. Stale sessions: open >24hr
  const staleSessions = queryAll(db, `
    SELECT s.id, p.name as project, s.started_at as started,
           ROUND((julianday('now') - julianday(s.started_at)) * 24, 1) as hours_open
    FROM sessions s
    JOIN projects p ON s.project_id = p.id
    WHERE s.ended_at IS NULL AND s.started_at < datetime('now', '-24 hours')
  `) as any[];
  report.stale_sessions = staleSessions;
  if (staleSessions.length > 0) {
    report.recommendations.push(`${staleSessions.length} sessions open >24hr — auto-close?`);
  }

  // 4. Unclaimed swarm tasks: pending >7 days
  const unclaimed = queryAll(db, `
    SELECT st.id, st.name, p.name as project
    FROM swarm_tasks st
    JOIN projects p ON st.project_id = p.id
    WHERE st.status = 'pending' AND st.created_at < datetime('now', '-7 days')
  `) as any[];
  report.unclaimed_swarm_tasks = unclaimed;
  if (unclaimed.length > 0) {
    report.recommendations.push(`${unclaimed.length} swarm tasks unclaimed >7 days`);
  }

  // Auto-fix if requested
  if (autoFix && (stuckWorkers.length > 0 || staleSessions.length > 0)) {
    let fixed = 0;
    for (const w of stuckWorkers) {
      db.run("UPDATE agent_workers SET status = 'failed', completed_at = datetime('now') WHERE id = ?", [w.id]);
      fixed++;
    }
    for (const s of staleSessions) {
      db.run("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?", [s.id]);
      fixed++;
    }
    report.recommendations.push(`Auto-fixed: ${fixed} orphaned records cleaned`);
  }

  report.total_orphans = orphanProjects.length + stuckWorkers.length
    + staleSessions.length + unclaimed.length;

  // Naming feedback for the user
  const lines: string[] = [];
  if (report.total_orphans === 0) {
    lines.push("✓ No orphans found — platform is clean");
  } else {
    lines.push(`${report.total_orphans} orphaned records found`);
    if (!autoFix && report.total_orphans > 0) {
      lines.push("Run with --fix to auto-clean stuck workers and stale sessions");
    }
  }
  report.recommendations = [...lines, ...report.recommendations];

  return report;
}
