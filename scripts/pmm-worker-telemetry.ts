#!/usr/bin/env bun
/**
 * PMM Worker Telemetry — Track agent execution patterns
 * ======================================================
 * Call this after agent completion to record telemetry.
 *
 * Usage: bun scripts/pmm-worker-telemetry.ts <worker-id> [--tokens <n>] [--tools "<list>"] [--rework <n>] [--output-quality <0-1>]
 */
import { openDb, queryOne, run } from "../src/db";

const args = process.argv.slice(2);
if (!args.length) {
  console.log("Usage: bun scripts/pmm-worker-telemetry.ts <worker-id> [options]");
  process.exit(1);
}

const workerId = parseInt(args[0]!);
let tokens: number | null = null;
let toolList: string | null = null;
let rework: number | null = null;
let outputQuality: number | null = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--tokens" && args[i + 1]) tokens = parseInt(args[++i]!);
  else if (args[i] === "--tools" && args[i + 1]) toolList = args[++i]!;
  else if (args[i] === "--rework" && args[i + 1]) rework = parseInt(args[++i]!);
  else if (args[i] === "--output-quality" && args[i + 1]) outputQuality = parseFloat(args[++i]!);
}

const db = openDb();

try {
  const worker = queryOne(db, "SELECT * FROM agent_workers WHERE id = ?", [workerId]) as any;
  if (!worker) { console.log(`Worker #${workerId} not found`); process.exit(1); }

  // Update telemetry fields
  const sets: string[] = [];
  const vals: any[] = [];

  if (tokens !== null) {
    sets.push("token_usage = ?");
    vals.push(tokens);
    // Estimate cost: ~$0.01/1K tokens for sonnet, $0.05/1K for opus
    let rate = 0.01;
    if (worker.model === "opus") rate = 0.05;
    else if (worker.model === "haiku") rate = 0.0025;
    const cost = (tokens / 1000) * rate;
    sets.push("cost_estimate = ?");
    vals.push(Math.round(cost * 10000) / 10000);
  }

  if (rework !== null) {
    sets.push("retry_count = ?");
    vals.push(rework);
  }

  if (sets.length > 0) {
    vals.push(workerId);
    run(db, `UPDATE agent_workers SET ${sets.join(", ")} WHERE id = ?`, vals);
    console.log(`Telemetry recorded for worker #${workerId}:`, {
      tokens: tokens ?? worker.token_usage,
      cost: tokens ? `$${((tokens / 1000) * (worker.model === "opus" ? 0.05 : worker.model === "haiku" ? 0.0025 : 0.01)).toFixed(4)}` : "N/A",
      rework: rework ?? worker.retry_count,
    });
  }

  // Generate oracle insight for unusual patterns
  if (rework && rework > 2) {
    const exists = queryOne(db,
      "SELECT id FROM oracle_insights WHERE title LIKE ? AND created_at > datetime('now', '-1 day')",
      [`%Worker #${workerId}%`]
    );
    if (!exists) {
      run(db,
        `INSERT INTO oracle_insights (category, title, description, source, confidence, impact_score, feasibility, status)
         VALUES ('observation', ?, ?, 'worker-telemetry', 0.80, 0.60, 0.70, 'new')`,
        [
          `High rework: Worker #${workerId} (${worker.agent_type})`,
          `${worker.agent_type} agent required ${rework} retries. Task: ${worker.task_description?.slice(0, 100) || 'unknown'}. Model: ${worker.model}. Consider: task too complex for model tier, unclear prompt, or missing context.`,
        ]
      );
      console.log(`  -> Oracle insight created for high rework pattern`);
    }
  }

  // Agent efficiency summary
  const stats = queryOne(db,
    `SELECT COUNT(*) as total, AVG(token_usage) as avg_tokens, SUM(cost_estimate) as total_cost
     FROM agent_workers WHERE agent_type = ? AND token_usage IS NOT NULL`,
    [worker.agent_type]
  ) as any;

  if (stats.total > 1) {
    console.log(`\n  Agent type stats (${worker.agent_type}):`);
    console.log(`    Total runs: ${stats.total}`);
    console.log(`    Avg tokens: ${Math.round(stats.avg_tokens || 0)}`);
    console.log(`    Total cost: $${(stats.total_cost || 0).toFixed(4)}`);
  }
} finally {
  db.close();
}
