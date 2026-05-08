/**
 * Token Budget Tracker — "Bundle Analyzer" for PMM-AI
 * ====================================================
 * Tracks token consumption per agent type, per project, per session.
 * Surfaces expensive agents, identifies token-hog patterns.
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne } from "../db";

export interface TokenBudget {
  by_agent_type: { agent_type: string; workers: number; total_tokens: number; avg_tokens: number }[];
  by_project: { project: string; workers: number; total_tokens: number }[];
  by_model: { model: string; workers: number; total_tokens: number; avg_tokens: number }[];
  top_expensive_workers: { id: number; agent_type: string; project: string; tokens: number; cost: number }[];
  overall: {
    total_workers: number;
    total_tokens: number;
    total_cost_estimate: number;
    avg_tokens_per_worker: number;
  };
  alerts: string[];
}

/** Approximate cost per 1M tokens for each model tier. */
const MODEL_COST: Record<string, number> = {
  haiku: 0.80, sonnet: 3.00, opus: 15.00,
  "deepseek-v4-flash": 0.50, "deepseek-v4-pro": 5.00,
  claudehaiku: 0.80, claudesonnet: 3.00, claudeopus: 15.00,
};

/** Generate a full token budget report. */
export function analyze(db: Database, projectName?: string): TokenBudget {
  const projectFilter = projectName
    ? "AND p.name = ?" : "";
  const params: any[] = projectName ? [projectName] : [];

  // By agent type
  const byAgent = queryAll(db, `
    SELECT w.agent_type, COUNT(*) as workers,
           COALESCE(SUM(w.token_usage), 0) as total_tokens,
           CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(w.token_usage), 0) / COUNT(*) ELSE 0 END as avg_tokens
    FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.token_usage IS NOT NULL ${projectFilter}
    GROUP BY w.agent_type ORDER BY total_tokens DESC
  `, params) as any[];

  // By project
  const byProject = queryAll(db, `
    SELECT p.name as project, COUNT(*) as workers,
           COALESCE(SUM(w.token_usage), 0) as total_tokens
    FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.token_usage IS NOT NULL ${projectFilter}
    GROUP BY p.name ORDER BY total_tokens DESC
  `, params) as any[];

  // By model
  const byModel = queryAll(db, `
    SELECT w.model, COUNT(*) as workers,
           COALESCE(SUM(w.token_usage), 0) as total_tokens,
           CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(w.token_usage), 0) / COUNT(*) ELSE 0 END as avg_tokens
    FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.token_usage IS NOT NULL ${projectFilter}
    GROUP BY w.model ORDER BY total_tokens DESC
  `, params) as any[];

  // Top expensive workers
  const topExpensive = queryAll(db, `
    SELECT w.id, w.agent_type, p.name as project,
           COALESCE(w.token_usage, 0) as tokens,
           COALESCE(w.cost_estimate, 0) as cost
    FROM agent_workers w
    JOIN projects p ON w.project_id = p.id
    WHERE w.token_usage IS NOT NULL ${projectFilter}
    ORDER BY w.token_usage DESC LIMIT 10
  `, params) as any[];

  // Overall stats
  const overallRow = queryOne(db, `
    SELECT COUNT(*) as workers,
           COALESCE(SUM(token_usage), 0) as total_tokens,
           COALESCE(SUM(cost_estimate), 0) as total_cost,
           CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(token_usage), 0) / COUNT(*) ELSE 0 END as avg
    FROM agent_workers
    WHERE token_usage IS NOT NULL ${projectFilter}
  `, params) as any;

  const alerts: string[] = [];

  // Alert: agents with no token tracking
  const untracked = (queryOne(db, `
    SELECT COUNT(*) as c FROM agent_workers WHERE token_usage IS NULL
  `) as any)?.c ?? 0;
  if (untracked > 5) alerts.push(`${untracked} workers have no token usage data — enable tracking`);

  // Alert: most expensive agent
  if (byAgent.length > 0 && byAgent[0].total_tokens > 100000) {
    alerts.push(`${byAgent[0].agent_type} consumed ${byAgent[0].total_tokens.toLocaleString()} tokens across ${byAgent[0].workers} workers`);
  }

  // Alert: model cost optimization
  const opusWorkers = byModel.find((m: any) => m.model === "opus" || m.model === "deepseek-v4-pro");
  if (opusWorkers && opusWorkers.total_tokens > 500000) {
    alerts.push(`Model "${opusWorkers.model}" used ${opusWorkers.total_tokens.toLocaleString()} tokens — consider sonnet for non-critical tasks`);
  }

  return {
    by_agent_type: byAgent,
    by_project: byProject,
    by_model: byModel,
    top_expensive_workers: topExpensive,
    overall: {
      total_workers: overallRow?.workers ?? 0,
      total_tokens: overallRow?.total_tokens ?? 0,
      total_cost_estimate: overallRow?.total_cost ?? 0,
      avg_tokens_per_worker: overallRow?.avg ?? 0,
    },
    alerts,
  };
}
