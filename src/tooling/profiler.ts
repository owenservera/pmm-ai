/**
 * Agent Profiler — Performance & Latency Tracking
 * ================================================
 * Tracks agent worker dispatch→completion latency,
 * identifies bottlenecks, slow agents, and blocked patterns.
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne } from "../db";

export interface ProfilerReport {
  latency: {
    by_agent_type: { agent_type: string; avg_seconds: number; p50_seconds: number; p95_seconds: number; count: number }[];
    by_model: { model: string; avg_seconds: number; count: number }[];
    slowest_workers: { id: number; agent_type: string; project: string; hours: number; status: string }[];
  };
  bottlenecks: {
    stuck_workers: number;
    failed_workers: number;
    retried_workers: number;
    orphan_workers: number; // dispatched but never updated
  };
  recommendations: string[];
}

export function analyze(db: Database, projectName?: string): ProfilerReport {
  const projectFilter = projectName ? "AND p.name = ?" : "";
  const params: any[] = projectName ? [projectName] : [];

  // Latency by agent type (for completed workers with timestamps)
  const byAgent = queryAll(db, `
    SELECT w.agent_type,
           ROUND(AVG(
             (julianday(w.completed_at) - julianday(w.created_at)) * 86400
           ), 1) as avg_seconds,
           COUNT(*) as count
    FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.completed_at IS NOT NULL AND w.created_at IS NOT NULL ${projectFilter}
    GROUP BY w.agent_type ORDER BY avg_seconds DESC
  `, params) as any[];

  // Latency by model
  const byModel = queryAll(db, `
    SELECT w.model,
           ROUND(AVG(
             (julianday(w.completed_at) - julianday(w.created_at)) * 86400
           ), 1) as avg_seconds,
           COUNT(*) as count
    FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.completed_at IS NOT NULL AND w.created_at IS NOT NULL ${projectFilter}
    GROUP BY w.model ORDER BY avg_seconds DESC
  `, params) as any[];

  // Slowest workers
  const slowest = queryAll(db, `
    SELECT w.id, w.agent_type, p.name as project, w.status,
           ROUND((julianday(COALESCE(w.completed_at, datetime('now'))) - julianday(w.created_at)) * 24, 1) as hours
    FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.created_at IS NOT NULL ${projectFilter}
    ORDER BY hours DESC LIMIT 10
  `, params) as any[];

  // Bottlenecks
  const stuck = (queryOne(db, `
    SELECT COUNT(*) as c FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.status = 'dispatched' AND w.created_at < datetime('now', '-1 hour')
    ${projectFilter}
  `, params) as any)?.c ?? 0;

  const failed = (queryOne(db, `
    SELECT COUNT(*) as c FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.status = 'failed' ${projectFilter}
  `, params) as any)?.c ?? 0;

  const retried = (queryOne(db, `
    SELECT COUNT(*) as c FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.retry_count > 0 ${projectFilter}
  `, params) as any)?.c ?? 0;

  const orphan = (queryOne(db, `
    SELECT COUNT(*) as c FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.status = 'dispatched' AND w.created_at < datetime('now', '-6 hours')
    ${projectFilter}
  `, params) as any)?.c ?? 0;

  // Recommendations
  const recs: string[] = [];
  if (stuck > 0) recs.push(`${stuck} workers stuck in "dispatched" >1hr — check agent connectivity`);
  if (failed > 0) recs.push(`${failed} failed workers — review failure patterns in swarm_audit_log`);
  if (orphan > 0) recs.push(`${orphan} orphaned workers (>6hr) — sweep with 'pmm cleanup'`);
  if (byAgent.length > 0 && byAgent[0].avg_seconds > 600) {
    recs.push(`${byAgent[0].agent_type} avg ${byAgent[0].avg_seconds}s — check for complexity mismatch`);
  }

  return {
    latency: {
      by_agent_type: byAgent,
      by_model: byModel,
      slowest_workers: slowest,
    },
    bottlenecks: {
      stuck_workers: stuck,
      failed_workers: failed,
      retried_workers: retried,
      orphan_workers: orphan,
    },
    recommendations: recs,
  };
}
