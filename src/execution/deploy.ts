/**
 * PMM Swarm Deploy Engine
 * =======================
 * Resolves the dependency graph from swarm_tasks, builds worker prompts,
 * generates Claude Code Task() call blocks, and advances the swarm wave-by-wave.
 *
 * This is the bridge between the planning layer (swarm_tasks, agent_layers,
 * agent_tracks) and actual parallel execution via Claude Code's Task() primitive.
 *
 * Rust-translatable: pure transforms over typed data, DB passed as parameter.
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne, run } from "../db";
import { injectWorkerTracking, ROUTING_CODES } from "../commands/shared-swarm";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SwarmTask {
  id: number;
  project_id: number;
  layer_num: number;
  track_letter: string | null;
  routing_code: number;
  name: string;
  description: string | null;
  acceptance_criteria: string | null;
  dependencies: number[]; // parsed from JSON
  status: string;
  raci_responsible: string | null;
  raci_accountable: string | null;
  estimated_tokens: number | null;
}

export interface SwarmLayer {
  id: number;
  layer_num: number;
  name: string;
  topology: string;
  consensus: string;
  checkpoint_interval: number;
  min_model_tier: string;
}

export interface SwarmTrack {
  id: number;
  layer_num: number;
  track_letter: string;
  name: string;
  role: string;
  assigned_agent: string | null;
  assigned_model: string;
  assigned_harness: string;
  isolation_mode: string;
  file_domain: string | null;
}

export interface DeployedTask {
  /** Worker ID created in agent_workers — use for pmm_swarm_collect */
  worker_id: number;
  /** Swarm task ID checked out */
  task_id: number;
  layer_num: number;
  track_letter: string | null;
  /** PMM role (executor, architect, researcher, etc.) */
  agent_type: string;
  model: "haiku" | "sonnet" | "opus";
  title: string;
  /** Full agent prompt — already includes worker tracking instructions */
  prompt: string;
  /** Verbatim Task() call block for Claude Code to execute */
  task_call: string;
  estimated_tokens: number | null;
}

export interface BlockedTask {
  task_id: number;
  title: string;
  layer_num: number;
  /** task IDs that must complete first */
  blocked_by: number[];
}

export interface DeployPlan {
  project: string;
  project_id: number;
  /** Tasks dispatched as workers — run these Task() calls */
  ready_tasks: DeployedTask[];
  /** Tasks waiting on incomplete dependencies */
  blocked_tasks: BlockedTask[];
  /** Tasks that have no more pending work (already completed) */
  completed_count: number;
  /** Human-readable execution instruction */
  execution_note: string;
  /** True if the entire swarm is done */
  swarm_complete: boolean;
}

export interface CollectOptions {
  /** Worker IDs that have finished */
  completed_worker_ids: number[];
  /** Summaries keyed by worker_id */
  summaries?: Record<number, string>;
  max_parallel?: number;
}

export interface DeployOptions {
  /** Only deploy tasks from this layer */
  layer?: number;
  /** Max concurrent tasks (default: 5 — Claude Code's limit) */
  max_parallel?: number;
  /** Preview plan without creating workers or checking out tasks */
  dry_run?: boolean;
  /** Force all tasks to this model tier */
  model_override?: "haiku" | "sonnet" | "opus";
}

// ── Model Tier Resolution ────────────────────────────────────────────────────

const ROUTING_TO_MODEL: Record<number, "haiku" | "sonnet" | "opus"> = {
  0: "haiku",   // Quick Fix
  1: "sonnet",  // Bug Fix
  3: "sonnet",  // Feature
  5: "sonnet",  // Refactor
  7: "sonnet",  // Performance
  9: "opus",    // Security Audit
  11: "opus",   // Architecture
  13: "haiku",  // Documentation
  15: "sonnet", // Research
  17: "sonnet", // Testing
};

function resolveModel(
  task: SwarmTask,
  track: SwarmTrack | null,
  layerMinTier: string,
  override?: "haiku" | "sonnet" | "opus",
): "haiku" | "sonnet" | "opus" {
  if (override) return override;
  // Track assignment wins
  const trackModel = track?.assigned_model;
  if (trackModel === "opus" || trackModel === "haiku") return trackModel as "haiku" | "opus";
  if (trackModel === "sonnet") return "sonnet";
  // Routing code default
  const routingModel = ROUTING_TO_MODEL[task.routing_code] ?? "sonnet";
  // Layer minimum tier
  if (layerMinTier === "opus") return "opus";
  if (layerMinTier === "haiku" && routingModel === "haiku") return "haiku";
  return routingModel;
}

function resolveAgentType(task: SwarmTask, track: SwarmTrack | null): string {
  if (track?.assigned_agent) return track.assigned_agent;
  const rc = ROUTING_CODES[task.routing_code];
  if (!rc) return "executor";
  // Map routing code name → agent type
  const nameToAgent: Record<string, string> = {
    "Quick Fix": "executor-low",
    "Bug Fix": "executor",
    "Feature": "executor",
    "Refactor": "executor",
    "Performance": "executor",
    "Security Audit": "security-reviewer",
    "Architecture": "architect",
    "Documentation": "writer",
    "Research": "researcher",
    "Testing": "tdd-guide",
  };
  return nameToAgent[rc.name] ?? "executor";
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

export function buildAgentPrompt(
  task: SwarmTask,
  workerId: number,
  project: { name: string; phase: string; repo_path: string; tech_stack: string[] },
  layer: SwarmLayer | null,
  track: SwarmTrack | null,
  completedDeps: Array<{ id: number; name: string; evidence: string | null }>,
): string {
  const agentType = resolveAgentType(task, track);
  const layerName = layer ? `L${layer.layer_num}: ${layer.name}` : `L${task.layer_num}`;
  const trackDesc = track ? `${task.track_letter}: ${track.name} [${track.role}]` : (task.track_letter ?? "unassigned");
  const fileDomain = track?.file_domain ?? "workspace-wide";

  let prompt = `You are a PMM specialized agent: **${agentType}**.
Working on project: **${project.name}** (phase: ${project.phase})
Repo path: ${project.repo_path || "detect from context"}
Tech stack: ${project.tech_stack.join(", ") || "detect from context"}

---

## YOUR TASK
**${task.name}**
`;

  if (task.description) {
    prompt += `\n${task.description}\n`;
  }

  if (task.acceptance_criteria) {
    prompt += `\n### Acceptance Criteria\n${task.acceptance_criteria}\n`;
  }

  prompt += `
### Context
- Layer: ${layerName}
- Track: ${trackDesc}
- File domain: ${fileDomain}
- Routing code: ${task.routing_code} (${ROUTING_CODES[task.routing_code]?.name ?? "Custom"})
`;

  if (completedDeps.length > 0) {
    prompt += `\n### Dependency Outputs (retrieve before starting)\n`;
    for (const dep of completedDeps) {
      prompt += `- Task #${dep.id}: ${dep.name}`;
      if (dep.evidence) prompt += `\n  Evidence: ${dep.evidence}`;
      prompt += "\n";
    }
    prompt += `Run: bun scripts/cli.ts swarm pool ${project.name} --status completed\nto see what completed tasks produced.\n`;
  }

  prompt += `
### Instructions
1. Read the project context: \`bun scripts/cli.ts project get "${project.name}"\`
2. Complete the task according to the acceptance criteria.
3. Verify your work before marking complete.
4. Record any architectural decisions made: \`bun scripts/cli.ts decision add "${project.name}" ...\`
5. If you hit a blocker, record it: \`bun scripts/cli.ts roadblock add "${project.name}" ...\`
`;

  // Inject the mandatory 5-step worker tracking protocol
  prompt = injectWorkerTracking(prompt, workerId, {
    project: project.name,
    layerNum: task.layer_num,
    trackLetter: task.track_letter ?? undefined,
    routingCode: task.routing_code,
    swarmTaskId: task.id,
    dependencies: task.dependencies.length > 0 ? task.dependencies.map(String).join(", ") : undefined,
  });

  return prompt;
}

// ── Task() Call Builder ───────────────────────────────────────────────────────

export function buildTaskCall(
  task: SwarmTask,
  workerId: number,
  agentType: string,
  model: string,
  prompt: string,
): string {
  // Escape backticks and double-quotes in prompt for embedding
  const safePrompt = prompt
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");

  return (
    `Task(\n` +
    `  subagent_type="general_purpose",\n` +
    `  model="${model}",\n` +
    `  description="[PMM #${workerId}] ${task.name}",\n` +
    `  prompt="${safePrompt}",\n` +
    `  run_in_background=True\n` +
    `)`
  );
}

// ── Dependency Resolution ────────────────────────────────────────────────────

export function resolveReadyTasks(
  tasks: SwarmTask[],
  completedTaskIds: Set<number>,
): { ready: SwarmTask[]; blocked: SwarmTask[] } {
  const ready: SwarmTask[] = [];
  const blocked: SwarmTask[] = [];

  for (const task of tasks) {
    if (task.status === "completed" || task.status === "review") continue;
    if (task.status === "claimed" || task.status === "in_progress") continue;
    if (task.status !== "pending") continue;

    const unmet = task.dependencies.filter((depId) => !completedTaskIds.has(depId));
    if (unmet.length === 0) {
      ready.push(task);
    } else {
      blocked.push(task);
    }
  }

  return { ready, blocked };
}

// ── Raw DB Loaders ────────────────────────────────────────────────────────────

function loadProject(db: Database, projectName: string) {
  const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [projectName]) as any;
  if (!project) throw new Error(`Project "${projectName}" not found. Register it first.`);
  return {
    id: project.id as number,
    name: project.name as string,
    phase: (project.phase as string) ?? "build",
    repo_path: (project.repo_path as string) ?? "",
    tech_stack: JSON.parse((project.tech_stack as string) || "[]") as string[],
  };
}

function loadSwarmTasks(db: Database, projectId: number, layerFilter?: number): SwarmTask[] {
  let sql = "SELECT * FROM swarm_tasks WHERE project_id = ?";
  const params: any[] = [projectId];
  if (layerFilter !== undefined) {
    sql += " AND layer_num = ?";
    params.push(layerFilter);
  }
  sql += " ORDER BY layer_num, track_letter";
  const rows = queryAll(db, sql, params);
  return rows.map((r: any) => ({
    ...r,
    dependencies: (() => {
      try { return JSON.parse(r.dependencies || "[]"); } catch { return []; }
    })(),
  })) as SwarmTask[];
}

function loadLayers(db: Database, projectId: number): SwarmLayer[] {
  return queryAll(db, "SELECT * FROM agent_layers WHERE project_id = ? ORDER BY layer_num", [projectId]) as SwarmLayer[];
}

function loadTracks(db: Database, projectId: number): SwarmTrack[] {
  return queryAll(
    db,
    `SELECT t.*, l.layer_num FROM agent_tracks t
     JOIN agent_layers l ON t.layer_id = l.id
     WHERE l.project_id = ? ORDER BY l.layer_num, t.track_letter`,
    [projectId],
  ) as SwarmTrack[];
}

function findTrack(tracks: SwarmTrack[], layerNum: number, trackLetter: string | null): SwarmTrack | null {
  if (!trackLetter) return null;
  return tracks.find((t) => t.layer_num === layerNum && t.track_letter === trackLetter) ?? null;
}

function findLayer(layers: SwarmLayer[], layerNum: number): SwarmLayer | null {
  return layers.find((l) => l.layer_num === layerNum) ?? null;
}

// ── Core Deploy Engine ────────────────────────────────────────────────────────

/**
 * Build a deploy plan from the current swarm task pool.
 *
 * For each ready task (dependencies met, status=pending):
 * 1. Creates an agent_workers row (unless dry_run)
 * 2. Checks out the swarm_task (unless dry_run)
 * 3. Builds the agent prompt with worker tracking
 * 4. Generates the verbatim Task() call string
 *
 * Returns the ready tasks to execute + blocked tasks info.
 */
export function buildDeployPlan(
  db: Database,
  projectName: string,
  options: DeployOptions = {},
): DeployPlan {
  const project = loadProject(db, projectName);
  const allTasks = loadSwarmTasks(db, project.id, options.layer);
  const layers = loadLayers(db, project.id);
  const tracks = loadTracks(db, project.id);

  // Completed task IDs (for dependency resolution)
  const completedTaskIds = new Set<number>(
    allTasks.filter((t) => t.status === "completed").map((t) => t.id),
  );

  // Pending tasks only
  const pendingTasks = allTasks.filter((t) => t.status === "pending");
  const { ready, blocked } = resolveReadyTasks(allTasks, completedTaskIds);

  // Cap at max_parallel
  const maxParallel = options.max_parallel ?? 5;
  const taskBatch = ready.slice(0, maxParallel);

  const deployedTasks: DeployedTask[] = [];

  for (const task of taskBatch) {
    const layer = findLayer(layers, task.layer_num);
    const track = findTrack(tracks, task.layer_num, task.track_letter);
    const model = resolveModel(task, track, layer?.min_model_tier ?? "sonnet", options.model_override);
    const agentType = resolveAgentType(task, track);

    // Fetch completed dependency outputs for context
    const completedDeps: Array<{ id: number; name: string; evidence: string | null }> = [];
    for (const depId of task.dependencies) {
      const dep = queryOne(db, "SELECT id, name, evidence FROM swarm_tasks WHERE id = ?", [depId]) as any;
      if (dep) completedDeps.push({ id: dep.id, name: dep.name, evidence: dep.evidence });
    }

    let workerId: number;

    if (!options.dry_run) {
      // 1. Create worker record
      const workerResult = db.run(
        `INSERT INTO agent_workers
         (project_id, name, agent_type, model, task_description, status,
          layer_num, track_letter, routing_code, swarm_task_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'dispatched', ?, ?, ?, ?, datetime('now'))`,
        [
          project.id,
          task.name,
          agentType,
          model,
          task.description ?? task.name,
          task.layer_num,
          task.track_letter,
          task.routing_code,
          task.id,
        ],
      );
      workerId = Number(workerResult.lastInsertRowid);

      // 2. Check out the swarm task
      run(db,
        `UPDATE swarm_tasks
         SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
        [workerId, task.id],
      );

      // 3. Audit log
      run(db,
        `INSERT INTO swarm_audit_log
         (project_id, task_id, worker_id, action, layer_num, track_letter)
         VALUES (?, ?, ?, 'checkout', ?, ?)`,
        [project.id, task.id, workerId, task.layer_num, task.track_letter],
      );
    } else {
      // Dry run: use placeholder worker ID
      workerId = -(task.id);
    }

    const prompt = buildAgentPrompt(task, workerId, project, layer, track, completedDeps);
    const taskCall = buildTaskCall(task, workerId, agentType, model, prompt);

    deployedTasks.push({
      worker_id: workerId,
      task_id: task.id,
      layer_num: task.layer_num,
      track_letter: task.track_letter,
      agent_type: agentType,
      model,
      title: task.name,
      prompt,
      task_call: taskCall,
      estimated_tokens: task.estimated_tokens,
    });
  }

  // Build blocked task list
  const blockedTasks: BlockedTask[] = blocked.map((t) => ({
    task_id: t.id,
    title: t.name,
    layer_num: t.layer_num,
    blocked_by: t.dependencies.filter((depId) => !completedTaskIds.has(depId)),
  }));

  const completedCount = allTasks.filter((t) => t.status === "completed").length;
  const totalCount = allTasks.length;
  const swarmComplete = pendingTasks.length === 0 && blocked.length === 0 && deployedTasks.length === 0;

  let executionNote: string;
  if (deployedTasks.length === 0 && swarmComplete) {
    executionNote = `Swarm complete. All ${completedCount} tasks finished.`;
  } else if (deployedTasks.length === 0 && blocked.length > 0) {
    executionNote = `No ready tasks. ${blocked.length} blocked (dependencies pending). Wait for running tasks to complete, then call pmm_swarm_collect.`;
  } else {
    const parallel = deployedTasks.length > 1 ? `${deployedTasks.length} in parallel` : "1 task";
    const remaining = totalCount - completedCount - deployedTasks.length;
    executionNote =
      `Execute ${parallel} (${options.dry_run ? "DRY RUN — no workers created" : "workers created"}).\n` +
      `${blocked.length} tasks blocked on dependencies. ${remaining} more tasks after this wave.\n` +
      `When all Task() calls complete, call pmm_swarm_collect with the worker IDs.`;
  }

  return {
    project: projectName,
    project_id: project.id,
    ready_tasks: deployedTasks,
    blocked_tasks: blockedTasks,
    completed_count: completedCount,
    execution_note: executionNote,
    swarm_complete: swarmComplete,
  };
}

// ── Collect & Advance ─────────────────────────────────────────────────────────

/**
 * Mark a wave of workers complete, update swarm_tasks, and return the next wave.
 *
 * Call this after all Task() calls from a deploy wave have returned.
 */
export function advanceSwarm(
  db: Database,
  projectName: string,
  options: CollectOptions,
): DeployPlan {
  const project = loadProject(db, projectName);
  const { completed_worker_ids, summaries = {}, max_parallel = 5 } = options;

  for (const workerId of completed_worker_ids) {
    const worker = queryOne(db, "SELECT * FROM agent_workers WHERE id = ?", [workerId]) as any;
    if (!worker) continue;

    const summary = summaries[workerId] ?? "Completed via pmm_swarm_collect";

    // Mark worker completed
    run(db,
      `UPDATE agent_workers
       SET status = 'completed', completed_at = datetime('now'), result_summary = ?
       WHERE id = ?`,
      [summary, workerId],
    );

    // Mark swarm task completed (checkin → completed)
    if (worker.swarm_task_id) {
      run(db,
        `UPDATE swarm_tasks
         SET status = 'completed', completed_at = datetime('now'),
             evidence = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [summary, worker.swarm_task_id],
      );

      // Audit log
      run(db,
        `INSERT INTO swarm_audit_log
         (project_id, task_id, worker_id, action, layer_num, track_letter, details)
         VALUES (?, ?, ?, 'checkin', ?, ?, ?)`,
        [project.id, worker.swarm_task_id, workerId, worker.layer_num, worker.track_letter, summary],
      );
    }
  }

  // Return the next wave
  return buildDeployPlan(db, projectName, { max_parallel });
}

// ── Live Status ───────────────────────────────────────────────────────────────

export interface SwarmStatus {
  project: string;
  total_tasks: number;
  pending: number;
  claimed: number;
  in_progress: number;
  completed: number;
  failed: number;
  escalated: number;
  progress_pct: number;
  layers: Array<{
    layer_num: number;
    name: string;
    pending: number;
    active: number;
    completed: number;
  }>;
  active_workers: Array<{
    worker_id: number;
    task_name: string;
    agent_type: string;
    model: string;
    layer_num: number | null;
    status: string;
    started_at: string | null;
  }>;
}

export function getSwarmStatus(db: Database, projectName: string): SwarmStatus {
  const project = loadProject(db, projectName);
  const allTasks = loadSwarmTasks(db, project.id);
  const layers = loadLayers(db, project.id);

  const counts = {
    pending: 0, claimed: 0, in_progress: 0, completed: 0, failed: 0, escalated: 0,
  };
  for (const t of allTasks) {
    const s = t.status as keyof typeof counts;
    if (s in counts) counts[s]++;
  }

  const total = allTasks.length;
  const progressPct = total > 0 ? Math.round((counts.completed / total) * 100) : 0;

  const layerStats = layers.map((l) => {
    const lt = allTasks.filter((t) => t.layer_num === l.layer_num);
    return {
      layer_num: l.layer_num,
      name: l.name,
      pending: lt.filter((t) => t.status === "pending").length,
      active: lt.filter((t) => t.status === "claimed" || t.status === "in_progress").length,
      completed: lt.filter((t) => t.status === "completed").length,
    };
  });

  const activeWorkers = queryAll(
    db,
    `SELECT id as worker_id, name as task_name, agent_type, model, layer_num, status, started_at
     FROM agent_workers
     WHERE project_id = ? AND status IN ('dispatched','running','waiting')
     ORDER BY created_at DESC LIMIT 20`,
    [project.id],
  ) as any[];

  return {
    project: projectName,
    total_tasks: total,
    ...counts,
    progress_pct: progressPct,
    layers: layerStats,
    active_workers: activeWorkers,
  };
}
