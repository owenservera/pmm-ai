/**
 * PMM Swarm Shared Utilities
 * ===========================
 * ROUTING_CODES, injectWorkerTracking(), buildHandoffManifest(),
 * buildDependencyGraph() — the swarm orchestration building blocks.
 *
 * Rust-translatable: pure data transforms, no side effects beyond
 * the injected prompt string returned to caller.
 */

/** Agent routing codes — map task types to layer pipelines. Adopted from ruflo ADR-026. */
export const ROUTING_CODES: Record<number, { name: string; description: string; pipeline: string[]; topology: string; strategy: string }> = {
  0:  { name: "Quick Fix",      description: "Single-file change, no review needed",           pipeline: ["L3","L4"],           topology: "star",       strategy: "balanced" },
  1:  { name: "Bug Fix",         description: "Bug investigation and fix with verification",    pipeline: ["L3","L2","L4"],      topology: "hierarchical", strategy: "specialized" },
  3:  { name: "Feature",         description: "Full feature from architecture to tests",        pipeline: ["L0","L1","L2","L3","L4"], topology: "hierarchical", strategy: "specialized" },
  5:  { name: "Refactor",        description: "Code restructuring without behavior change",     pipeline: ["L0","L1","L2","L4"], topology: "hierarchical", strategy: "specialized" },
  7:  { name: "Performance",     description: "Optimization with benchmarking",                 pipeline: ["L2","L3","L4"],      topology: "hierarchical", strategy: "specialized" },
  9:  { name: "Security Audit",  description: "Vulnerability scanning and threat modeling",     pipeline: ["L1","L3","L4"],      topology: "hierarchical", strategy: "specialized" },
  11: { name: "Architecture",    description: "Architecture design and decision records",       pipeline: ["L0","L1","L3"],      topology: "hierarchical", strategy: "specialized" },
  13: { name: "Documentation",   description: "Docs generation and standards compliance",       pipeline: ["L3","L4"],           topology: "mesh",         strategy: "balanced" },
  15: { name: "Research",        description: "Deep research and pattern discovery",            pipeline: ["L3"],                topology: "star",         strategy: "balanced" },
  17: { name: "Testing",         description: "Test suite creation and coverage improvement",   pipeline: ["L3","L4"],           topology: "star",         strategy: "balanced" },
};

/** Mandatory Memory Protocol — injected into every worker prompt. Adopted from ruflo's 5-step coordination protocol. */
export function injectWorkerTracking(
  prompt: string,
  workerId: number,
  config?: { project?: string; layerNum?: number; trackLetter?: string; routingCode?: number; swarmTaskId?: number; dependencies?: string }
): string {
  const meta: string[] = [
    `\n--- PMM WORKER PROTOCOL (MANDATORY) ---`,
    `YOUR PMM WORKER ID IS #${workerId}.`,
    `Run 'bun scripts/pmm.ts worker update ${workerId} --status running --started'.`,
  ];
  if (config?.project) meta.push(`Project: ${config.project}`);
  if (config?.layerNum !== undefined) meta.push(`Layer: L${config.layerNum}${config.trackLetter ? "." + config.trackLetter : ""}`);
  if (config?.swarmTaskId) meta.push(`Swarm Task: #${config.swarmTaskId}`);
  if (config?.dependencies) meta.push(`Dependencies (must retrieve before starting): ${config.dependencies}`);

  meta.push(``);
  meta.push(`MANDATORY 5-STEP MEMORY PROTOCOL (every agent MUST follow):`);
  meta.push(`1. WRITE initial status: bun scripts/pmm.ts swarm audit <project> ${workerId} status_update '{"status":"starting","timestamp":"$(date -Iseconds)"}'`);
  meta.push(`2. CHECK dependencies before working — retrieve all dependency artifacts from shared namespace`);
  meta.push(`3. UPDATE progress after each significant step — share intermediate artifacts`);
  meta.push(`4. SHARE artifacts others need — write key outputs to swarm_audit_log for other agents to retrieve`);
  meta.push(`5. SIGNAL completion: bun scripts/pmm.ts worker update ${workerId} --status completed --result "[summary of what was accomplished]"`);
  meta.push(``);
  meta.push(`On completion, if you produced files, record them:`);
  meta.push(`  bun scripts/pmm.ts swarm audit <project> ${workerId} artifact_share '{"files":["path/to/file1","path/to/file2"],"summary":"..."}'`);
  meta.push(`---`);

  return prompt + "\n" + meta.join("\n");
}

/** Build a swarm handoff manifest — the contract between planning and execution. */
export function buildHandoffManifest(
  projectName: string,
  project: any,
  layers: any[],
  tracks: any[],
  tasks: any[],
  options?: { includeCompleted?: boolean; targetFormat?: string }
): any {
  const tracksByLayer: Record<number, any[]> = {};
  for (const t of tracks) {
    const ln = t.layer_num;
    if (!tracksByLayer[ln]) tracksByLayer[ln] = [];
    tracksByLayer[ln]!.push(t);
  }

  const tasksByLayer: Record<number, any[]> = {};
  for (const t of tasks) {
    if (!options?.includeCompleted && t.status === "completed") continue;
    const ln = t.layer_num;
    if (!tasksByLayer[ln]) tasksByLayer[ln] = [];
    tasksByLayer[ln]!.push(t);
  }

  const manifest = {
    handoff_version: "1.0",
    generated_at: new Date().toISOString(),
    project: {
      name: project.name,
      phase: project.phase,
      priority: project.priority,
      tech_stack: JSON.parse(project.tech_stack || "[]"),
      repo_path: project.repo_path,
    },
    layers: layers.map((l: any) => ({
      num: l.layer_num,
      name: l.name,
      description: l.description,
      topology: l.topology || "hierarchical",
      consensus: l.consensus || "L0-authority",
      checkpoint_interval: l.checkpoint_interval || 5,
      min_model_tier: l.min_model_tier || "sonnet",
      tracks: (tracksByLayer[l.layer_num] || []).map((t: any) => ({
        letter: t.track_letter,
        name: t.name,
        role: t.role,
        raci: t.raci,
        agent: t.assigned_agent,
        model: t.assigned_model,
        harness: t.assigned_harness || "claude-code",
        isolation_mode: t.isolation_mode || "file-domain",
        file_domain: t.file_domain,
        active: !!t.is_active,
      })),
    })),
    tasks: tasks.filter((t: any) => options?.includeCompleted || t.status !== "completed").map((t: any) => ({
      id: t.id,
      layer_num: t.layer_num,
      track_letter: t.track_letter,
      routing_code: t.routing_code || 3,
      name: t.name,
      description: t.description,
      acceptance_criteria: t.acceptance_criteria,
      status: t.status,
      dependencies: t.dependencies ? JSON.parse(t.dependencies) : [],
      raci: {
        R: t.raci_responsible,
        A: t.raci_accountable,
        C: t.raci_consulted,
        I: t.raci_informed,
      },
      estimated_tokens: t.estimated_tokens,
    })),
    dependency_graph: buildDependencyGraph(tasks),
    execution_order: layers.map((l: any) => `L${l.layer_num}`),
    routing_codes_used: [...new Set(tasks.map((t: any) => t.routing_code || 3))].reduce((acc: any, code: number) => {
      acc[String(code)] = ROUTING_CODES[code] || null;
      return acc;
    }, {}),
    total_estimated_tokens: tasks.reduce((sum: number, t: any) => sum + (t.estimated_tokens || 0), 0),
    ready_for_execution: tasks.filter((t: any) => t.status === "pending" && (!t.dependencies || JSON.parse(t.dependencies).length === 0)).length,
  };

  return manifest;
}

/** Build dependency DAG from swarm tasks. */
export function buildDependencyGraph(tasks: any[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const t of tasks) {
    const key = `L${t.layer_num}${t.track_letter ? "." + t.track_letter : ""}: ${t.name}`;
    const deps: string[] = [];
    if (t.dependencies) {
      try {
        const depIds = JSON.parse(t.dependencies);
        for (const depId of depIds) {
          const dep = tasks.find((x: any) => x.id === depId);
          if (dep) deps.push(`L${dep.layer_num}${dep.track_letter ? "." + dep.track_letter : ""}: ${dep.name}`);
        }
      } catch (_) {}
    }
    graph[key] = deps;
  }
  return graph;
}
