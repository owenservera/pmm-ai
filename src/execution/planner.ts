/**
 * PMM Swarm Planner — GOAP-style Goal Decomposition
 * ==================================================
 * Detects routing code from natural language goal, generates a structured
 * task breakdown using template library, and commits tasks to swarm_tasks.
 *
 * Flow: pmm_swarm_plan → review → pmm_swarm_plan_commit → pmm_swarm_deploy
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne, run } from "../db";
import { ROUTING_CODES } from "../commands/shared-swarm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlannedTask {
  layer_num: number;
  track_letter: string;
  name: string;
  description: string;
  acceptance_criteria: string;
  agent_type: string;
  model: "haiku" | "sonnet" | "opus";
  routing_code: number;
  /** Names of tasks this depends on — resolved to IDs at commit time */
  depends_on_names: string[];
  estimated_tokens: number;
}

export interface SwarmPlan {
  plan_id: string;
  project: string;
  goal: string;
  routing_code: number;
  routing_name: string;
  pipeline: string[];
  tasks: PlannedTask[];
  total_estimated_tokens: number;
  estimated_waves: number;
  confirm_prompt: string;
}

export interface CommitResult {
  plan_id: string;
  tasks_created: number;
  task_ids: number[];
  next_step: string;
}

export interface PlanOptions {
  routing_code?: number;
  max_tasks?: number;
  auto_commit?: boolean;
  model_preference?: "lean" | "balanced" | "quality";
}

// ── Routing Code Detection ────────────────────────────────────────────────────

const GOAL_PATTERNS: Array<{ regex: RegExp; code: number }> = [
  { regex: /\b(fix|bug|broken|error|crash|fail|issue|wrong|incorrect|patch)\b/i, code: 1 },
  { regex: /\b(security|audit|vuln|threat|exploit|cve|sanitiz|inject)\b/i, code: 9 },
  { regex: /\b(architect|design|schema|structure|model|plan|blueprint|diagram)\b/i, code: 11 },
  { regex: /\b(refactor|restructure|cleanup|clean.?up|reorganize|modularize|extract)\b/i, code: 5 },
  { regex: /\b(optim|performance|speed|fast|slow|latency|throughput|benchmark|profil)\b/i, code: 7 },
  { regex: /\b(test|spec|coverage|tdd|unit test|integration test|e2e)\b/i, code: 17 },
  { regex: /\b(doc|readme|comment|jsdoc|changelog|guide|tutorial|wiki)\b/i, code: 13 },
  { regex: /\b(research|investigate|explore|survey|analyz|discover|study|review)\b/i, code: 15 },
  { regex: /\b(add|implement|build|create|develop|write|make|new|feature|support)\b/i, code: 3 },
];

export function detectRoutingCode(goal: string): number {
  for (const { regex, code } of GOAL_PATTERNS) {
    if (regex.test(goal)) return code;
  }
  return 3; // default: Feature
}

// ── Model Assignment ──────────────────────────────────────────────────────────

function modelForLayer(layerNum: number, pref: "lean" | "balanced" | "quality"): "haiku" | "sonnet" | "opus" {
  if (pref === "lean") return layerNum === 0 ? "sonnet" : "haiku";
  if (pref === "quality") return layerNum === 0 || layerNum === 2 ? "opus" : "sonnet";
  // balanced
  return layerNum === 0 ? "opus" : "sonnet";
}

function agentForLayer(layerNum: number): string {
  const map: Record<number, string> = {
    0: "architect",
    1: "executor-low",
    2: "executor",
    3: "researcher",
    4: "executor",
  };
  return map[layerNum] ?? "executor";
}

// ── Task Template Library ─────────────────────────────────────────────────────
// Keyed by routing_code → layer_num → template builder

type TemplateCtx = {
  goal: string;
  subject: string;   // key noun extracted from goal
  project: string;
  stack: string;
};

type TemplateBuilder = (ctx: TemplateCtx) => Omit<PlannedTask, "depends_on_names" | "model" | "agent_type" | "routing_code">;

const TEMPLATES: Record<number, Record<number, TemplateBuilder>> = {
  // ── Feature (code 3) ──────────────────────────────────────────────────────
  3: {
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Research: ${c.subject} patterns and best practices`,
      description: `Investigate existing implementations, community patterns, and ${c.stack} ecosystem solutions for: ${c.goal}`,
      acceptance_criteria: `Research summary written. Key patterns identified. At least 3 reference implementations reviewed. Decision points documented.`,
      estimated_tokens: 3000,
    }),
    0: (c) => ({
      layer_num: 0, track_letter: "A",
      name: `Design: ${c.subject} architecture`,
      description: `Design the architecture for: ${c.goal}. Define interfaces, data flows, and integration points.`,
      acceptance_criteria: `Architecture decision recorded via pmm decision add. Interface contracts defined. File structure mapped.`,
      estimated_tokens: 5000,
    }),
    1: (c) => ({
      layer_num: 1, track_letter: "A",
      name: `Scaffold: ${c.subject} file structure and types`,
      description: `Create file stubs, TypeScript interfaces, and module exports for: ${c.goal}`,
      acceptance_criteria: `All files created. Types compile. Existing tests still pass.`,
      estimated_tokens: 2000,
    }),
    2: (c) => ({
      layer_num: 2, track_letter: "A",
      name: `Implement: ${c.subject} core logic`,
      description: `Implement the core business logic for: ${c.goal}. No integration yet — focus on the algorithm/logic layer.`,
      acceptance_criteria: `Core logic implemented. Unit tests passing. Edge cases handled.`,
      estimated_tokens: 8000,
    }),
    4: (c) => ({
      layer_num: 4, track_letter: "A",
      name: `Integrate & test: ${c.subject}`,
      description: `Wire up and integrate: ${c.goal}. Write integration tests. Verify end-to-end behavior.`,
      acceptance_criteria: `Feature integrated and working. Integration tests pass. No regressions in existing tests.`,
      estimated_tokens: 6000,
    }),
  },

  // ── Bug Fix (code 1) ──────────────────────────────────────────────────────
  1: {
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Investigate: ${c.subject} root cause`,
      description: `Diagnose the root cause of: ${c.goal}. Reproduce the bug, trace the failure path, identify the fix location.`,
      acceptance_criteria: `Root cause identified. Reproduction steps documented. Fix location pinpointed.`,
      estimated_tokens: 3000,
    }),
    2: (c) => ({
      layer_num: 2, track_letter: "A",
      name: `Fix: ${c.subject}`,
      description: `Implement the fix for: ${c.goal}. Apply the minimal correct change. Add regression test.`,
      acceptance_criteria: `Bug fixed. Regression test added. No new failures introduced.`,
      estimated_tokens: 4000,
    }),
    4: (c) => ({
      layer_num: 4, track_letter: "A",
      name: `Verify & close: ${c.subject}`,
      description: `Verify the fix for: ${c.goal}. Run full test suite. Document the fix in decision log.`,
      acceptance_criteria: `All tests pass. Fix verified in realistic conditions. Decision recorded.`,
      estimated_tokens: 2000,
    }),
  },

  // ── Refactor (code 5) ─────────────────────────────────────────────────────
  5: {
    0: (c) => ({
      layer_num: 0, track_letter: "A",
      name: `Plan: ${c.subject} refactor strategy`,
      description: `Plan the refactor approach for: ${c.goal}. Map current structure, define target structure, identify risk areas.`,
      acceptance_criteria: `Refactor plan documented. Before/after structure mapped. Risk areas identified. No behavior changes planned.`,
      estimated_tokens: 4000,
    }),
    1: (c) => ({
      layer_num: 1, track_letter: "A",
      name: `Prepare: ${c.subject} scaffolding`,
      description: `Create new file/module structure for refactored code: ${c.goal}. Set up without breaking existing.`,
      acceptance_criteria: `New structure created alongside old. Existing tests still pass. Migration path clear.`,
      estimated_tokens: 2000,
    }),
    2: (c) => ({
      layer_num: 2, track_letter: "A",
      name: `Refactor: ${c.subject} core`,
      description: `Apply the refactor to: ${c.goal}. Migrate logic to new structure. Maintain all existing behavior.`,
      acceptance_criteria: `Logic migrated. All existing tests pass. No behavior changes. Old code removed or deprecated.`,
      estimated_tokens: 7000,
    }),
    4: (c) => ({
      layer_num: 4, track_letter: "A",
      name: `Cleanup & verify: ${c.subject}`,
      description: `Final cleanup after refactor of: ${c.goal}. Remove dead code, update imports, verify full test suite.`,
      acceptance_criteria: `No dead code. All imports correct. Full test suite passes. Build clean.`,
      estimated_tokens: 2000,
    }),
  },

  // ── Research (code 15) ────────────────────────────────────────────────────
  15: {
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Research: ${c.subject}`,
      description: `Deep research on: ${c.goal}. Survey the landscape, evaluate options, synthesize findings.`,
      acceptance_criteria: `Research brief written with findings, options, tradeoffs, and recommendation. Decision recorded in PMM.`,
      estimated_tokens: 6000,
    }),
  },

  // ── Architecture (code 11) ────────────────────────────────────────────────
  11: {
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Survey: ${c.subject} existing patterns`,
      description: `Survey existing architecture and relevant patterns for: ${c.goal}`,
      acceptance_criteria: `Current state documented. Relevant patterns identified. Gaps noted.`,
      estimated_tokens: 3000,
    }),
    0: (c) => ({
      layer_num: 0, track_letter: "A",
      name: `Design: ${c.subject}`,
      description: `Design the architecture for: ${c.goal}. Produce decision records, interface specs, and data flow diagrams.`,
      acceptance_criteria: `Architecture documented. ADR created. Interfaces specified. Team can implement without further design.`,
      estimated_tokens: 8000,
    }),
    1: (c) => ({
      layer_num: 1, track_letter: "A",
      name: `Validate: ${c.subject} design`,
      description: `Validate the architecture design for: ${c.goal}. Prototype critical paths, identify unknowns.`,
      acceptance_criteria: `Design validated. Unknowns resolved or documented. Implementation plan ready.`,
      estimated_tokens: 4000,
    }),
  },

  // ── Performance (code 7) ──────────────────────────────────────────────────
  7: {
    2: (c) => ({
      layer_num: 2, track_letter: "A",
      name: `Profile: ${c.subject} bottlenecks`,
      description: `Profile and identify performance bottlenecks in: ${c.goal}`,
      acceptance_criteria: `Bottlenecks identified with measurements. Baseline benchmark established.`,
      estimated_tokens: 3000,
    }),
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Research: ${c.subject} optimization strategies`,
      description: `Research optimization techniques for: ${c.goal}`,
      acceptance_criteria: `Top 3 optimization strategies identified with expected impact estimates.`,
      estimated_tokens: 3000,
    }),
    4: (c) => ({
      layer_num: 4, track_letter: "A",
      name: `Optimize: ${c.subject}`,
      description: `Implement performance optimizations for: ${c.goal}. Measure improvement vs baseline.`,
      acceptance_criteria: `Optimizations applied. Benchmark shows improvement. No regressions. Numbers documented.`,
      estimated_tokens: 6000,
    }),
  },

  // ── Testing (code 17) ─────────────────────────────────────────────────────
  17: {
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Survey: ${c.subject} test coverage gaps`,
      description: `Survey current test coverage and identify gaps for: ${c.goal}`,
      acceptance_criteria: `Coverage report analyzed. Critical gaps listed. Test plan documented.`,
      estimated_tokens: 2000,
    }),
    4: (c) => ({
      layer_num: 4, track_letter: "A",
      name: `Write: ${c.subject} test suite`,
      description: `Write comprehensive tests for: ${c.goal}. Unit, integration, and edge cases.`,
      acceptance_criteria: `Test suite written. Coverage improved. All tests green. CI passes.`,
      estimated_tokens: 8000,
    }),
  },

  // ── Documentation (code 13) ───────────────────────────────────────────────
  13: {
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Audit: ${c.subject} documentation gaps`,
      description: `Audit current docs and identify gaps for: ${c.goal}`,
      acceptance_criteria: `Gap analysis complete. Missing docs listed. Priority order established.`,
      estimated_tokens: 2000,
    }),
    4: (c) => ({
      layer_num: 4, track_letter: "A",
      name: `Write: ${c.subject} documentation`,
      description: `Write documentation for: ${c.goal}. Include usage examples and edge cases.`,
      acceptance_criteria: `Documentation complete, accurate, and reviewed. Examples tested.`,
      estimated_tokens: 4000,
    }),
  },

  // ── Security Audit (code 9) ───────────────────────────────────────────────
  9: {
    1: (c) => ({
      layer_num: 1, track_letter: "A",
      name: `Map: ${c.subject} attack surface`,
      description: `Map the attack surface and threat model for: ${c.goal}`,
      acceptance_criteria: `Threat model documented. Attack vectors listed by severity.`,
      estimated_tokens: 4000,
    }),
    3: (c) => ({
      layer_num: 3, track_letter: "A",
      name: `Audit: ${c.subject} vulnerabilities`,
      description: `Audit code and config for security vulnerabilities related to: ${c.goal}`,
      acceptance_criteria: `Audit complete. Findings documented with CVSS scores. Fixes prioritized.`,
      estimated_tokens: 5000,
    }),
    4: (c) => ({
      layer_num: 4, track_letter: "A",
      name: `Remediate: ${c.subject} security issues`,
      description: `Fix security vulnerabilities identified in audit: ${c.goal}`,
      acceptance_criteria: `All critical/high issues remediated. Verified by re-audit. Security test added.`,
      estimated_tokens: 6000,
    }),
  },
};

// ── Subject Extraction ────────────────────────────────────────────────────────

/** Extract the key noun/subject from the goal string (simple heuristic). */
function extractSubject(goal: string): string {
  // Strip leading verb (add, fix, implement, etc.)
  const stripped = goal.replace(/^(add|fix|implement|build|create|refactor|optimize|write|design|research|investigate|document|test|audit)\s+/i, "").trim();
  // Take first 4-6 words
  const words = stripped.split(/\s+/);
  return words.slice(0, 5).join(" ");
}

// ── Dependency Wiring ─────────────────────────────────────────────────────────

/** Wire up sequential layer dependencies based on pipeline ordering. */
function wireDependencies(tasks: PlannedTask[], pipeline: string[]): PlannedTask[] {
  // Build ordered layer sequence from pipeline
  const layerOrder = pipeline.map((p) => parseInt(p.replace("L", "")));

  // For each task, depend on all tasks in the PREVIOUS layer in the pipeline
  return tasks.map((task) => {
    const myPipelineIdx = layerOrder.indexOf(task.layer_num);
    if (myPipelineIdx <= 0) return { ...task, depends_on_names: [] };

    const prevLayer = layerOrder[myPipelineIdx - 1]!;
    const prevTasks = tasks.filter((t) => t.layer_num === prevLayer);
    return { ...task, depends_on_names: prevTasks.map((t) => t.name) };
  });
}

// ── Plan Builder ──────────────────────────────────────────────────────────────

export function buildSwarmPlan(
  db: Database,
  projectName: string,
  goal: string,
  options: PlanOptions = {},
): SwarmPlan {
  const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [projectName]) as any;
  if (!project) throw new Error(`Project "${projectName}" not found.`);

  const stack = JSON.parse(project.tech_stack || "[]").join(", ") || "detect from context";
  const routingCode = options.routing_code ?? detectRoutingCode(goal);
  const rc = ROUTING_CODES[routingCode];
  if (!rc) throw new Error(`Unknown routing code: ${routingCode}`);

  const pipeline = rc.pipeline; // e.g. ["L0","L1","L2","L3","L4"]
  const subject = extractSubject(goal);
  const pref = options.model_preference ?? "balanced";

  const ctx: TemplateCtx = { goal, subject, project: projectName, stack };
  const layerTemplates = TEMPLATES[routingCode] ?? TEMPLATES[3]!;

  // Build tasks from templates for each layer in the pipeline
  const rawTasks: PlannedTask[] = [];
  for (const layerStr of pipeline) {
    const layerNum = parseInt(layerStr.replace("L", ""));
    const builder = layerTemplates[layerNum];
    if (!builder) continue;

    const base = builder(ctx);
    rawTasks.push({
      ...base,
      layer_num: layerNum,
      agent_type: agentForLayer(layerNum),
      model: modelForLayer(layerNum, pref),
      routing_code: routingCode,
      depends_on_names: [], // filled in next step
    });
  }

  // Cap at max_tasks
  const maxTasks = options.max_tasks ?? 10;
  const cappedTasks = rawTasks.slice(0, maxTasks);

  // Wire sequential dependencies
  const wiredTasks = wireDependencies(cappedTasks, pipeline);

  const totalTokens = wiredTasks.reduce((s, t) => s + t.estimated_tokens, 0);

  // Count waves: each unique layer = 1 wave
  const uniqueLayers = new Set(wiredTasks.map((t) => t.layer_num));
  const estimatedWaves = uniqueLayers.size;

  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    plan_id: planId,
    project: projectName,
    goal,
    routing_code: routingCode,
    routing_name: rc.name,
    pipeline,
    tasks: wiredTasks,
    total_estimated_tokens: totalTokens,
    estimated_waves: estimatedWaves,
    confirm_prompt:
      `Review the ${wiredTasks.length}-task plan above. ` +
      `If it looks good, call pmm_swarm_plan_commit with plan_id="${planId}". ` +
      `Or call pmm_swarm_plan again with routing_code to override the detected type.`,
  };
}

// ── Commit (in-memory plan → DB) ──────────────────────────────────────────────

/** Pending plans stored in memory keyed by plan_id. */
const PENDING_PLANS = new Map<string, { projectName: string; plan: SwarmPlan }>();

export function cachePlan(plan: SwarmPlan): void {
  PENDING_PLANS.set(plan.plan_id, { projectName: plan.project, plan });
}

export function commitSwarmPlan(
  db: Database,
  planId: string,
  overrides?: Partial<{ routing_code: number; model_override: string }>,
): CommitResult {
  const cached = PENDING_PLANS.get(planId);
  if (!cached) throw new Error(`Plan "${planId}" not found. Call pmm_swarm_plan first.`);

  const { projectName, plan } = cached;
  const project = queryOne(db, "SELECT id FROM projects WHERE name = ?", [projectName]) as any;
  if (!project) throw new Error(`Project "${projectName}" not found.`);

  // Ensure layers exist
  for (const layerStr of plan.pipeline) {
    const layerNum = parseInt(layerStr.replace("L", ""));
    const layerNames: Record<number, string> = {
      0: "Architecture & Design", 1: "Scaffolding & Dependencies",
      2: "Core Logic", 3: "Research & Standards", 4: "Implementation",
    };
    db.run(
      `INSERT OR IGNORE INTO agent_layers (project_id, layer_num, name, topology, consensus)
       VALUES (?,?,'${layerNames[layerNum] ?? `Layer ${layerNum}`}','hierarchical','L0-authority')`,
      [project.id, layerNum],
    );
  }

  // Insert tasks in order, tracking name→id map for dependency resolution
  const nameToId = new Map<string, number>();
  const taskIds: number[] = [];

  for (const task of plan.tasks) {
    // Resolve depends_on_names → ids
    const depIds: number[] = [];
    for (const depName of task.depends_on_names) {
      const id = nameToId.get(depName);
      if (id) depIds.push(id);
    }

    const result = db.run(
      `INSERT INTO swarm_tasks
       (project_id, layer_num, track_letter, routing_code, name, description,
        acceptance_criteria, dependencies, status, estimated_tokens)
       VALUES (?,?,?,?,?,?,?,?,'pending',?)`,
      [
        project.id,
        task.layer_num,
        task.track_letter,
        overrides?.routing_code ?? task.routing_code,
        task.name,
        task.description,
        task.acceptance_criteria,
        JSON.stringify(depIds),
        task.estimated_tokens,
      ],
    );

    const newId = Number(result.lastInsertRowid);
    nameToId.set(task.name, newId);
    taskIds.push(newId);
  }

  // Remove from pending
  PENDING_PLANS.delete(planId);

  return {
    plan_id: planId,
    tasks_created: taskIds.length,
    task_ids: taskIds,
    next_step: `${taskIds.length} tasks created. Now call pmm_swarm_deploy(project="${projectName}") to fire the first wave.`,
  };
}
