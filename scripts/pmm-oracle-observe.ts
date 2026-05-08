#!/usr/bin/env bun
/**
 * PMM Oracle Observation Pipeline
 * ==================================
 * Batch analysis of session data → pattern extraction → insight generation.
 * Runs weekly or on-demand via `bun scripts/pmm-oracle-observe.ts`.
 *
 * Phases:
 *   1. SUMMARIZE — per-session: task type, agents used, skills, errors
 *   2. PATTERN EXTRACT — cross-session: failure modes, underused capabilities
 *   3. OPPORTUNITY DETECT — compare usage vs capability
 *   4. RECOMMEND — generate oracle insights
 */
import { openDb, queryAll, queryOne, run } from "../src/db";

const db = openDb();
const now = new Date().toISOString();
let insightsGenerated = 0;

try {
  console.log("[oracle:observe] Starting observation pipeline...\n");

  // ── Phase 1: SUMMARIZE recent sessions ────────────────
  console.log("Phase 1: Session Summarization");
  const recentSessions = queryAll(db,
    `SELECT s.id, s.project_id, p.name as project_name, s.summary, s.started_at, s.ended_at
     FROM sessions s JOIN projects p ON s.project_id = p.id
     WHERE s.started_at > datetime('now', '-7 days')
     ORDER BY s.started_at DESC`
  ) as any[];

  const sessionStats: Record<string, { sessions: number; completed: number; errors: number }> = {};
  for (const s of recentSessions) {
    const workers = queryAll(db,
      "SELECT agent_type, status FROM agent_workers WHERE session_id = ?", [s.id]) as any[];
    const projName = s.project_name || "unknown";
    if (!sessionStats[projName]) sessionStats[projName] = { sessions: 0, completed: 0, errors: 0 };
    sessionStats[projName]!.sessions++;
    if (s.ended_at) sessionStats[projName]!.completed++;
    for (const w of workers) {
      if (w.status === "failed") sessionStats[projName]!.errors++;
    }
  }
  console.log(`  Analyzed ${recentSessions.length} sessions across ${Object.keys(sessionStats).length} projects`);

  // ── Phase 2: PATTERN EXTRACT ──────────────────────────
  console.log("\nPhase 2: Pattern Extraction");

  // Pattern: agent usage
  const agentUsage = queryAll(db,
    `SELECT agent_type, COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
     FROM agent_workers WHERE created_at > datetime('now', '-7 days')
     GROUP BY agent_type ORDER BY total DESC`
  ) as any[];
  console.log(`  Agent usage patterns (7d): ${agentUsage.length} agent types`);

  // Pattern: most common agent failure
  const failingAgents = agentUsage.filter((a: any) => a.failed > 0).sort((a: any, b: any) => b.failed - a.failed);
  if (failingAgents.length > 0) {
    const worst = failingAgents[0];
    console.log(`  Top failure: ${worst.agent_type} (${worst.failed}/${worst.total} failed)`);
  }

  // Pattern: underused capabilities
  const allAgents = queryAll(db, "SELECT name FROM subagents WHERE trackable = 1") as any[];
  const usedAgents = new Set(agentUsage.map((a: any) => a.agent_type));
  const unusedAgents = allAgents.filter((a: any) => !usedAgents.has(a.name));
  console.log(`  Unused agents (7d): ${unusedAgents.length}/${allAgents.length}`);

  // Pattern: skill invocation gaps
  const allSkills = queryAll(db, "SELECT name FROM skills WHERE status = 'active'") as any[];
  console.log(`  Registered skills: ${allSkills.length}`);

  // ── Phase 3: OPPORTUNITY DETECT ───────────────────────
  console.log("\nPhase 3: Opportunity Detection");

  // Detect: projects with no sessions in 7 days
  const inactiveProjects = queryAll(db,
    `SELECT p.name FROM projects p
     WHERE p.status = 'active' AND p.priority IN ('critical', 'high')
     AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.project_id = p.id AND s.started_at > datetime('now', '-7 days'))`
  ) as any[];
  if (inactiveProjects.length > 0) {
    console.log(`  Inactive critical projects (7d): ${inactiveProjects.length}`);
  }

  // Detect: sessions without verification
  const unverifiedSessions = (queryOne(db,
    `SELECT COUNT(*) as c FROM sessions s
     WHERE s.started_at > datetime('now', '-7 days')
     AND NOT EXISTS (SELECT 1 FROM verification_runs vr WHERE vr.session_id = s.id)`
  ) as any).c;
  console.log(`  Sessions without verification: ${unverifiedSessions}`);

  // Detect: drift between registered agents and actual usage
  const registeredAgentCount = (queryOne(db, "SELECT COUNT(*) as c FROM subagents") as any).c;
  console.log(`  Agent registry: ${registeredAgentCount} registered`);

  // ── Phase 4: RECOMMENDATIONS ──────────────────────────
  console.log("\nPhase 4: Recommendation Generation");

  // Insight: agent failure pattern
  for (const agent of failingAgents.slice(0, 3)) {
    if (agent.failed >= 2) {
      const exists = queryOne(db,
        "SELECT id FROM oracle_insights WHERE title LIKE ? AND created_at > datetime('now', '-3 days')",
        [`Agent failure: ${agent.agent_type}%`]
      );
      if (!exists) {
        run(db,
          `INSERT INTO oracle_insights (category, title, description, source, confidence, impact_score, feasibility, status)
           VALUES ('observation', ?, ?, 'oracle-observe', 0.85, 0.70, 0.80, 'new')`,
          [
            `Agent failure: ${agent.agent_type} (${agent.failed}/${agent.total})`,
            `${agent.agent_type} failed ${agent.failed} of ${agent.total} times in 7 days. ` +
            `Consider: model tier upgrade, clearer prompt patterns, or task decomposition.`
          ]
        );
        insightsGenerated++;
      }
    }
  }

  // Insight: underused agents
  if (unusedAgents.length >= 5) {
    const exists = queryOne(db,
      "SELECT id FROM oracle_insights WHERE title = 'Agent underutilization' AND created_at > datetime('now', '-7 days')"
    );
    if (!exists) {
      run(db,
        `INSERT INTO oracle_insights (category, title, description, source, confidence, impact_score, feasibility, status)
         VALUES ('observation', 'Agent underutilization', ?, 'oracle-observe', 0.80, 0.75, 0.85, 'new')`,
        [`${unusedAgents.length} trackable agents unused in 7 days: ${unusedAgents.map((a: any) => a.name).join(", ")}. ` +
         `Consider: conductor routing review, task complexity analysis, or agent deprecation.`]
      );
      insightsGenerated++;
    }
  }

  // Insight: verification gap
  if (unverifiedSessions > 0) {
    const exists = queryOne(db,
      "SELECT id FROM oracle_insights WHERE title = 'Session verification gap' AND created_at > datetime('now', '-3 days')"
    );
    if (!exists) {
      run(db,
        `INSERT INTO oracle_insights (category, title, description, source, confidence, impact_score, feasibility, status)
         VALUES ('observation', 'Session verification gap', ?, 'oracle-observe', 0.90, 0.80, 0.90, 'new')`,
        [`${unverifiedSessions} recent sessions have no verification runs recorded. ` +
         `Verification protocol (BUILD/TEST/FUNCTIONALITY) may not be executing on SessionEnd.`]
      );
      insightsGenerated++;
    }
  }

  // Insight: inactive critical projects
  if (inactiveProjects.length > 0) {
    const exists = queryOne(db,
      "SELECT id FROM oracle_insights WHERE title = 'Inactive critical projects' AND created_at > datetime('now', '-3 days')"
    );
    if (!exists) {
      run(db,
        `INSERT INTO oracle_insights (category, title, description, source, confidence, impact_score, feasibility, status)
         VALUES ('observation', 'Inactive critical projects', ?, 'oracle-observe', 0.90, 0.75, 0.70, 'new')`,
        [`${inactiveProjects.length} critical/high-priority projects have no sessions in 7 days: ` +
         `${(inactiveProjects as any[]).map((p: any) => p.name).join(", ")}. Consider: prioritization review or project archival.`]
      );
      insightsGenerated++;
    }
  }

  // ── Summary ────────────────────────────────────────────
  const totalInsights = (queryOne(db, "SELECT COUNT(*) as c FROM oracle_insights") as any).c;
  console.log(`\n=== Observation Complete ===`);
  console.log(`  New insights generated: ${insightsGenerated}`);
  console.log(`  Total oracle insights: ${totalInsights}`);
  console.log(`  Run 'bun scripts/pmm.ts oracle brief' for full report`);

} finally {
  db.close();
}
