#!/usr/bin/env bun
/**
 * PMM Evaluator — Agent-as-Judge Spawner
 * ========================================
 * For complex evals that require LLM reasoning.
 * Spawns the pmm-evaluator agent to score outputs against structured rubrics.
 *
 * Usage: bun scripts/pmm-evaluator-judge.ts <eval-id> [--target <path>] [--rubric <path>]
 */
import { openDb, queryOne, run } from "../src/db";

const args = process.argv.slice(2);
if (!args.length) { console.log("Usage: bun scripts/pmm-evaluator-judge.ts <eval-id> [--target <path>]"); process.exit(1); }

const evalId = args[0]!;
let targetPath: string | null = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--target" && args[i + 1]) targetPath = args[++i]!;
}

const db = openDb();

try {
  const evalDef = queryOne(db, "SELECT * FROM eval_defs WHERE eval_id = ?", [evalId]) as any;
  if (!evalDef) { console.log(`Eval "${evalId}" not found`); process.exit(1); }

  console.log(`=== Agent-as-Judge Evaluation ===`);
  console.log(`  Eval: ${evalDef.eval_id} (${evalDef.category})`);
  console.log(`  Target: ${targetPath || evalDef.target}`);
  console.log(`  Metric: ${evalDef.metric}`);

  // Dispatch instructions (what the pmm-evaluator agent gets)
  const judgePrompt = `
You are the PMM Evaluator (Agent-as-Judge). Score the target output against this rubric:

EVAL ID: ${evalDef.eval_id}
CATEGORY: ${evalDef.category}
TARGET: ${targetPath || evalDef.target}
METRIC: ${evalDef.metric}
HEALTHY THRESHOLD: ${evalDef.threshold_healthy || "N/A"}
ATTENTION THRESHOLD: ${evalDef.threshold_attention || "N/A"}
CRITICAL THRESHOLD: ${evalDef.threshold_critical || "N/A"}

RUBRIC DIMENSIONS:
1. Completeness — does the output cover all required aspects?
2. Correctness — are the claims accurate and verifiable?
3. Clarity — is the output well-structured and understandable?
4. Actionability — can a developer act on this output?

For each dimension, provide:
- Score (0-10)
- Evidence (specific quotes or observations)
- Reasoning

Then provide an overall score and recommendation.

CRITICAL OUTPUT CONTRACT: Your entire response must be valid JSON:
{
  "eval_id": "${evalDef.eval_id}",
  "overall_score": <0.0-1.0>,
  "verdict": "pass" | "attention" | "fail",
  "dimensions": [
    {"name": "...", "score": <0-10>, "evidence": "...", "reasoning": "..."}
  ],
  "recommendation": "..."
}
`;

  console.log(`\n  Judge instructions ready (${judgePrompt.length} chars)`);
  console.log(`  To execute: spawn pmm-evaluator agent with the prompt above`);
  console.log(`  Or use: bun scripts/pmm.ts worker dispatch pmm-evaluator sonnet "Judge eval ${evalId}" --project TERMINAL`);

  // Record that this eval needs agentic judgment
  const existing = queryOne(db,
    "SELECT id FROM eval_runs WHERE eval_def_id = ? AND triggered_by = 'agent-as-judge' AND run_at > datetime('now', '-1 day')",
    [evalDef.id]
  );
  if (!existing) {
    run(db,
      "INSERT INTO eval_runs (eval_def_id, status, result_json, run_at, triggered_by) VALUES (?, 'attention', ?, datetime('now'), 'agent-as-judge')",
      [evalDef.id, JSON.stringify({ note: "Agent-as-Judge evaluation queued. Spawn pmm-evaluator to complete.", judge_prompt_length: judgePrompt.length })]
    );
    console.log(`  \u2192 Queued for agentic evaluation`);
  }
} finally {
  db.close();
}
