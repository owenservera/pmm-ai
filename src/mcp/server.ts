#!/usr/bin/env bun
/**
 * PMM MCP Server — Model Context Protocol Interface
 * ==================================================
 * Exposes PMM state as MCP tools for any MCP-compatible AI harness.
 * stdio transport: reads JSON-RPC from stdin, writes to stdout.
 *
 * Usage (in .claude/mcp.json):
 *   "pmm": { "command": "bun", "args": ["src/pmm/mcp/server.ts"] }
 *
 * v4.2.0 — Added 9 write tools for CNS cross-harness integration.
 */
import { randomBytes } from "node:crypto";
import { openDb, queryAll, queryOne, run } from "../db";

/** Generate a unique harness session ID. */
function generateSessionId(harness: string): string {
  return `${harness}-${randomBytes(8).toString("hex")}`;
}

const DB = openDb();

// ── MCP Protocol ────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function respond(id: number | string, result: unknown): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(response) + "\n");
}

function error(id: number | string, code: number, message: string): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  process.stdout.write(JSON.stringify(response) + "\n");
}

// ── Tool Definitions ─────────────────────────────────────

const tools = [
  {
    name: "pmm_summary",
    description: "Get a quick overview of the PMM portfolio — project count, health, tools, agents, sessions.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "pmm_project_get",
    description: "Get detailed information about a PMM-tracked project: phase, stack, health, milestones, features, decisions.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Project name" } },
      required: ["name"],
    },
  },
  {
    name: "pmm_project_list",
    description: "List all PMM-tracked projects with status, phase, priority, and health.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (active/completed/archived)" },
        phase: { type: "string", description: "Filter by phase (discover/define/design/build/maintain)" },
        priority: { type: "string", description: "Filter by priority (critical/high/medium/low)" },
      },
      required: [],
    },
  },
  {
    name: "pmm_milestone_list",
    description: "List milestones for a PMM-tracked project.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        status: { type: "string", description: "Filter: pending, in-progress, completed, blocked" },
      },
      required: ["project"],
    },
  },
  {
    name: "pmm_feature_list",
    description: "List features for a PMM-tracked project.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        status: { type: "string", description: "Filter: planned, in-progress, done" },
      },
      required: ["project"],
    },
  },
  {
    name: "pmm_decision_list",
    description: "List architectural decisions for a project.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name" } },
      required: ["project"],
    },
  },
  {
    name: "pmm_process_scan",
    description: "Scan the workspace for active methodologies, artifacts, process phase, and gaps. Use this at session start to understand project state.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "pmm_health_check",
    description: "Run a portfolio health check — identifies attention-needed projects, staleness, roadblocks.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "pmm_dependencies",
    description: "Show dependencies for a project — what it depends on and what depends on it.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name" } },
      required: ["project"],
    },
  },
  {
    name: "pmm_context",
    description: "Generate an AI-ready context block for a project — phase, milestones, features, decisions, recent activity. Inject this into agent prompts.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name (defaults to auto-detect)" } },
      required: [],
    },
  },

  // ── Write Tools (CNS v4.2) ────────────────────────────

  {
    name: "pmm_session_start",
    description: "Register a new AI session in PMM from any harness (Claude Code, Antigravity, Gemini CLI, etc.). Call at session start to enable cross-harness tracking.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name to associate this session with" },
        harness: { type: "string", description: "AI harness name: claude-code, antigravity, gemini-cli, opencode, cursor, windsurf, custom" },
        model: { type: "string", description: "Model being used (e.g. claude-sonnet-4-5, gemini-2.5-pro)" },
      },
      required: ["project", "harness"],
    },
  },
  {
    name: "pmm_session_end",
    description: "Close an active PMM session with a summary of work done. Call at session end for continuity tracking.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "number", description: "Session ID returned by pmm_session_start" },
        summary: { type: "string", description: "Summary of what was accomplished in this session" },
        files_edited: { type: "array", items: { type: "string" }, description: "List of files edited" },
        tokens_used: { type: "number", description: "Approximate tokens consumed" },
      },
      required: ["session_id", "summary"],
    },
  },
  {
    name: "pmm_worker_dispatch",
    description: "Register and dispatch an agent worker in PMM. Returns a worker_id for tracking. Use before spawning a subagent.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        agent_type: { type: "string", description: "Agent type (e.g. executor, architect, pmm-planner)" },
        model: { type: "string", description: "Model tier: haiku, sonnet, opus" },
        task: { type: "string", description: "Task description for the worker" },
        layer_num: { type: "number", description: "Swarm layer number (optional)" },
      },
      required: ["project", "agent_type", "model", "task"],
    },
  },
  {
    name: "pmm_worker_update",
    description: "Update an agent worker's status and result. Call with status=running when starting, completed/failed when done.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "number", description: "Worker ID from pmm_worker_dispatch" },
        status: { type: "string", description: "New status: pending, running, completed, failed" },
        result_summary: { type: "string", description: "Summary of what the worker produced" },
      },
      required: ["worker_id", "status"],
    },
  },
  {
    name: "pmm_milestone_update",
    description: "Update the status of a project milestone. Use to mark milestones in-progress or completed as work progresses.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        milestone_name: { type: "string", description: "Milestone name (partial match supported)" },
        status: { type: "string", description: "New status: pending, in-progress, completed, blocked" },
      },
      required: ["project", "milestone_name", "status"],
    },
  },
  {
    name: "pmm_feature_update",
    description: "Update the status of a project feature. Use to track feature progress across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        feature_name: { type: "string", description: "Feature name (partial match supported)" },
        status: { type: "string", description: "New status: planned, in-progress, done, blocked" },
      },
      required: ["project", "feature_name", "status"],
    },
  },
  {
    name: "pmm_decision_add",
    description: "Record an architectural decision in PMM. Use when a significant technical choice is made during a session.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        question: { type: "string", description: "The decision question (e.g. 'Use SQLite or PostgreSQL?')" },
        decision: { type: "string", description: "The chosen answer" },
        rationale: { type: "string", description: "Reasoning behind the decision" },
      },
      required: ["project", "question", "decision"],
    },
  },
  {
    name: "pmm_roadblock_add",
    description: "Flag a roadblock or blocker for a project. Creates a tracked issue that persists across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        description: { type: "string", description: "Description of the roadblock" },
        severity: { type: "string", description: "Severity: low, medium, high, critical" },
      },
      required: ["project", "description", "severity"],
    },
  },
  {
    name: "pmm_alert_create",
    description: "Create a PMM alert for a project. Alerts are visible in the health dashboard and persist until resolved.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        severity: { type: "string", description: "Alert severity: info, warning, critical" },
        message: { type: "string", description: "Alert message" },
      },
      required: ["project", "severity", "message"],
    },
  },

  // ── Swarm Execution Tools (v4.3) ──────────────────────

  {
    name: "pmm_swarm_deploy",
    description: "Deploy the next wave of swarm tasks as parallel Claude Code Task() calls. Resolves dependency graph, creates workers, and returns verbatim Task() call blocks ready to execute. Call pmm_swarm_collect when all tasks complete to advance to the next wave.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        layer: { type: "number", description: "Deploy only tasks from this layer number (optional — defaults to all ready layers)" },
        max_parallel: { type: "number", description: "Max concurrent tasks to return (default: 5 — Claude Code's limit)" },
        dry_run: { type: "boolean", description: "Preview plan without creating workers or checking out tasks" },
        model_override: { type: "string", description: "Force all tasks to use this model: haiku, sonnet, or opus" },
      },
      required: ["project"],
    },
  },
  {
    name: "pmm_swarm_status_live",
    description: "Get real-time swarm progress: task counts by status, per-layer breakdown, and active worker list. Use during execution to monitor parallel task progress.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
      },
      required: ["project"],
    },
  },
  {
    name: "pmm_swarm_collect",
    description: "Mark a completed wave of Task() workers as done, update swarm task statuses, and return the next wave of ready Task() calls. Call this after all Task() calls from pmm_swarm_deploy have returned their results.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
        completed_worker_ids: {
          type: "array",
          items: { type: "number" },
          description: "Worker IDs that have finished (from pmm_swarm_deploy ready_tasks[].worker_id)",
        },
        summaries: {
          type: "object",
          description: "Map of worker_id → result summary string for each completed worker",
          additionalProperties: { type: "string" },
        },
        max_parallel: { type: "number", description: "Max tasks in the next wave (default: 5)" },
      },
      required: ["project", "completed_worker_ids"],
    },
  },
];

// ── Tool Handlers ────────────────────────────────────────

const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {
  pmm_summary: () => {
    const projects = queryAll(DB, "SELECT name, status, phase, priority, health FROM projects WHERE status = 'active' ORDER BY priority");
    const toolCount = (queryOne(DB, "SELECT COUNT(*) as c FROM tooling") as any).c;
    const agentCount = (queryOne(DB, "SELECT COUNT(*) as c FROM subagents") as any).c;
    const sessionCount = (queryOne(DB, "SELECT COUNT(*) as c FROM sessions") as any).c;
    const productCount = (queryOne(DB, "SELECT COUNT(*) as c FROM portfolio_nodes WHERE type = 'product'") as any).c;
    return {
      projects: projects.map((p: any) => ({ name: p.name, phase: p.phase, priority: p.priority, health: p.health })),
      counts: { total: projects.length, products: productCount, tools: toolCount, agents: agentCount, sessions: sessionCount },
    };
  },

  pmm_project_get: (params) => {
    const name = params.name as string;
    const project = queryOne(DB, "SELECT * FROM projects WHERE name = ?", [name]) as any;
    if (!project) return { error: `Project "${name}" not found` };

    const milestones = queryAll(DB, "SELECT id, name, due, status, acceptance_criteria FROM milestones WHERE project_id = ? ORDER BY id", [project.id]);
    const features = queryAll(DB, "SELECT id, name, status, priority, description FROM features WHERE project_id = ? ORDER BY priority", [project.id]);
    const decisions = queryAll(DB, "SELECT id, question, decision, rationale, status FROM decisions WHERE project_id = ?", [project.id]);
    const tasks = queryAll(DB, "SELECT id, name, status, milestone_id FROM atomic_tasks WHERE project_id = ? ORDER BY milestone_id", [project.id]);
    const tools = queryAll(DB, "SELECT tool_name, category, priority FROM tooling WHERE project_id = ?", [project.id]);

    return {
      name: project.name,
      status: project.status,
      phase: project.phase,
      priority: project.priority,
      health: project.health,
      tech_stack: JSON.parse(project.tech_stack || "[]"),
      repo_path: project.repo_path,
      milestones: milestones.map((m: any) => ({ id: m.id, name: m.name, due: m.due, status: m.status })),
      features: features.map((f: any) => ({ id: f.id, name: f.name, status: f.status, priority: f.priority })),
      decisions: decisions.map((d: any) => ({ id: d.id, question: d.question, decision: d.decision, status: d.status })),
      tasks_count: tasks.length,
      tools: tools.map((t: any) => t.tool_name),
    };
  },

  pmm_project_list: (params) => {
    let sql = "SELECT name, status, phase, priority, health FROM projects WHERE 1=1";
    const vals: any[] = [];
    if (params.status) { sql += " AND status = ?"; vals.push(params.status); }
    if (params.phase) { sql += " AND phase = ?"; vals.push(params.phase); }
    if (params.priority) { sql += " AND priority = ?"; vals.push(params.priority); }
    sql += " ORDER BY priority, name";
    return queryAll(DB, sql, vals);
  },

  pmm_milestone_list: (params) => {
    const project = queryOne(DB, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
    if (!project) return { error: `Project "${params.project}" not found` };
    let sql = "SELECT id, name, due, status, acceptance_criteria FROM milestones WHERE project_id = ?";
    const vals: any[] = [project.id];
    if (params.status) { sql += " AND status = ?"; vals.push(params.status); }
    sql += " ORDER BY id";
    return queryAll(DB, sql, vals);
  },

  pmm_feature_list: (params) => {
    const project = queryOne(DB, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
    if (!project) return { error: `Project "${params.project}" not found` };
    let sql = "SELECT id, name, status, priority, description FROM features WHERE project_id = ?";
    const vals: any[] = [project.id];
    if (params.status) { sql += " AND status = ?"; vals.push(params.status); }
    sql += " ORDER BY priority, name";
    return queryAll(DB, sql, vals);
  },

  pmm_decision_list: (params) => {
    const project = queryOne(DB, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
    if (!project) return { error: `Project "${params.project}" not found` };
    return queryAll(DB, "SELECT id, question, decision, rationale, status FROM decisions WHERE project_id = ?", [project.id]);
  },

  pmm_process_scan: async () => {
    try {
      const { processScan } = await import("../process/scan");
      return processScan();
    } catch (e: any) {
      return { error: e.message };
    }
  },

  pmm_health_check: () => {
    const projects = queryAll(DB, "SELECT name, phase, priority, health FROM projects WHERE status = 'active' ORDER BY priority");
    const stale = queryAll(DB, "SELECT name, health FROM projects WHERE status = 'active' AND health IN ('attention','blocked','stale')");
    return {
      total: projects.length,
      healthy: projects.filter((p: any) => p.health === "healthy").length,
      attention: projects.filter((p: any) => p.health === "attention").length,
      stale: projects.filter((p: any) => p.health === "stale").length,
      blocked: projects.filter((p: any) => p.health === "blocked").length,
      needs_attention: stale.map((p: any) => ({ name: p.name, health: p.health })),
    };
  },

  pmm_dependencies: (params) => {
    const project = queryOne(DB, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
    if (!project) return { error: `Project "${params.project}" not found` };
    const depends_on = queryAll(DB,
      `SELECT p.name, d.description FROM dependencies d JOIN projects p ON d.to_project_id = p.id WHERE d.from_project_id = ?`, [project.id]);
    const depended_by = queryAll(DB,
      `SELECT p.name, d.description FROM dependencies d JOIN projects p ON d.from_project_id = p.id WHERE d.to_project_id = ?`, [project.id]);
    return { project: params.project, depends_on, depended_by };
  },

  pmm_context: (params) => {
    let projectName = (params.project as string) || null;
    // Auto-detect active project if not specified
    if (!projectName) {
      const session = queryOne(DB, "SELECT p.name FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1") as any;
      if (session) projectName = session.name;
      if (!projectName) projectName = "TERMINAL";
    }
    const project = queryOne(DB, "SELECT * FROM projects WHERE name = ?", [projectName]) as any;
    if (!project) return { error: `Project "${projectName}" not found` };

    const milestones = queryAll(DB, "SELECT name, due, status FROM milestones WHERE project_id = ? ORDER BY id", [project.id]);
    const features = queryAll(DB, "SELECT name, status, priority FROM features WHERE project_id = ? AND status != 'done' ORDER BY priority LIMIT 5", [project.id]);
    const decisions = queryAll(DB, "SELECT question, decision FROM decisions WHERE project_id = ? ORDER BY id DESC LIMIT 5", [project.id]);
    const roadblocks = queryAll(DB, "SELECT description, severity FROM roadblocks WHERE project_id = ? AND resolved_at IS NULL", [project.id]);
    const product = queryOne(DB,
      `SELECT pn.name FROM portfolio_nodes pn
       JOIN portfolio_nodes pp ON pn.parent_id = pp.id
       WHERE pp.id = ? AND pn.type = 'component'`, [project.node_id]) as any;
    const productName = queryOne(DB, "SELECT name FROM portfolio_nodes WHERE id = ?", [project.node_id ? undefined : undefined]);
    const recentSessions = queryAll(DB,
      "SELECT summary, started_at FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 3", [project.id]);

    let context = `## PMM Project Context: ${project.name}\n\n`;
    context += `**Phase:** ${project.phase} | **Priority:** ${project.priority} | **Health:** ${project.health}\n`;
    if (product) context += `**Component:** ${(product as any).name}\n`;

    if (milestones.length) {
      context += `\n### Milestones\n`;
      for (const m of milestones as any[]) {
        const icon = m.status === "completed" ? "✓" : m.status === "in-progress" ? "▶" : "○";
        context += `- ${icon} ${m.name}${m.due ? ` (due: ${m.due})` : ""}\n`;
      }
    }

    if (features.length) {
      context += `\n### Active Features\n`;
      for (const f of features as any[]) {
        context += `- ${f.name} [${f.priority}]\n`;
      }
    }

    if (roadblocks.length) {
      context += `\n### ⚠ Roadblocks\n`;
      for (const r of roadblocks as any[]) {
        context += `- ${r.severity}: ${r.description}\n`;
      }
    }

    if (decisions.length) {
      context += `\n### Recent Decisions\n`;
      for (const d of decisions as any[]) {
        context += `- ${d.question.slice(0, 80)}... → ${d.decision.slice(0, 80)}...\n`;
      }
    }

    if (recentSessions.length) {
      context += `\n### Recent Activity\n`;
      for (const s of recentSessions as any[]) {
        if (s.summary) context += `- ${String(s.started_at).slice(0, 10)}: ${s.summary.slice(0, 100)}\n`;
      }
    }

    // Auto-context: suggest next action
    const incompleteMilestones = milestones.filter((m: any) => m.status !== "completed");
    const activeFeatures = features.filter((f: any) => f.status === "in-progress" || f.status === "planned");
    if (activeFeatures.length > 0) {
      context += `\n### Suggested Next Actions\n`;
      context += `- Features ready: ${activeFeatures.length}. Run \`bun scripts/pmm.ts feature list "${project.name}"\`\n`;
    }
    if (incompleteMilestones.length > 0) {
      context += `- Milestones pending: ${incompleteMilestones.length}. Next: ${(incompleteMilestones[0] as any).name}\n`;
    }

    return { project: project.name, context };
  },

  // ── Write Tool Handlers (CNS v4.2) ─────────────────────

  pmm_session_start: (params) => {
    const db = openDb();
    try {
      const proj = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
      if (!proj) return { error: `Project "${params.project}" not found` };

      const result = db.run(
        `INSERT INTO sessions (project_id, started_at, summary) VALUES (?, datetime('now'), '')`,
        [proj.id],
      );
      const sessionId = result.lastInsertRowid as number;

      // Harness session tracking (graceful if table doesn't exist yet)
      const harnessSessionId = generateSessionId(params.harness as string);
      try {
        db.run(
          `INSERT INTO harness_sessions (harness, session_id, project_id, model_used) VALUES (?, ?, ?, ?)`,
          [params.harness, harnessSessionId, proj.id, (params.model as string) || null],
        );
      } catch {
        // harness_sessions table not yet created — run: bun scripts/migrate-cns-harness.ts
      }

      return { session_id: sessionId, harness_session_id: harnessSessionId, project: params.project };
    } finally {
      db.close();
    }
  },

  pmm_session_end: (params) => {
    const db = openDb();
    try {
      const sessionId = params.session_id as number;
      db.run(
        `UPDATE sessions SET ended_at = datetime('now'), summary = ? WHERE id = ?`,
        [(params.summary as string) || "", sessionId],
      );

      // Update harness_sessions if tracking is available
      try {
        const filesEdited = params.files_edited ? JSON.stringify(params.files_edited) : null;
        db.run(
          `UPDATE harness_sessions SET ended_at = datetime('now'), summary = ?, files_edited = ?, tokens_used = ? WHERE session_id LIKE ?`,
          [
            (params.summary as string) || "",
            filesEdited,
            (params.tokens_used as number) || null,
            `%-${sessionId}`,
          ],
        );
      } catch {
        // harness_sessions table not yet created
      }

      return { ok: true, session_id: sessionId };
    } finally {
      db.close();
    }
  },

  pmm_worker_dispatch: (params) => {
    const db = openDb();
    try {
      const proj = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
      if (!proj) return { error: `Project "${params.project}" not found` };

      const task = params.task as string;
      const result = db.run(
        `INSERT INTO agent_workers (project_id, name, agent_type, model, task_description, status, layer_num, created_at)
         VALUES (?, ?, ?, ?, ?, 'dispatched', ?, datetime('now'))`,
        [
          proj.id,
          task,
          params.agent_type as string,
          params.model as string,
          task,
          (params.layer_num as number) || null,
        ],
      );

      return { worker_id: result.lastInsertRowid, project: params.project, status: "pending" };
    } finally {
      db.close();
    }
  },

  pmm_worker_update: (params) => {
    const db = openDb();
    try {
      const workerId = params.worker_id as number;
      const status = params.status as string;
      const validStatuses = ["idle", "dispatched", "running", "waiting", "completed", "failed", "cancelled"];
      if (!validStatuses.includes(status)) {
        return { error: `Invalid status "${status}". Must be one of: ${validStatuses.join(", ")}` };
      }

      const sets: string[] = ["status = ?"];
      const values: any[] = [status];

      if (status === "running") {
        sets.push("started_at = datetime('now')");
      }
      if (status === "completed" || status === "failed" || status === "cancelled") {
        sets.push("completed_at = datetime('now')");
      }
      if (params.result_summary) {
        sets.push("result_summary = ?");
        values.push(params.result_summary as string);
      }

      values.push(workerId);
      db.run(`UPDATE agent_workers SET ${sets.join(", ")} WHERE id = ?`, values);

      return { ok: true, worker_id: workerId, status };
    } finally {
      db.close();
    }
  },

  pmm_milestone_update: (params) => {
    const db = openDb();
    try {
      const proj = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
      if (!proj) return { error: `Project "${params.project}" not found` };

      const validStatuses = ["pending", "in-progress", "completed", "blocked"];
      if (!validStatuses.includes(params.status as string)) {
        return { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` };
      }

      const result = db.run(
        `UPDATE milestones SET status = ?, updated_at = datetime('now')
         WHERE project_id = ? AND name LIKE ?`,
        [params.status, proj.id, `%${params.milestone_name}%`],
      );

      if (result.changes === 0) {
        return { error: `No milestone matching "${params.milestone_name}" found in project "${params.project}"` };
      }

      const updated = queryOne(
        db,
        "SELECT id, name, status, due FROM milestones WHERE project_id = ? AND name LIKE ? LIMIT 1",
        [proj.id, `%${params.milestone_name}%`],
      );
      return { ok: true, changes: result.changes, milestone: updated };
    } finally {
      db.close();
    }
  },

  pmm_feature_update: (params) => {
    const db = openDb();
    try {
      const proj = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
      if (!proj) return { error: `Project "${params.project}" not found` };

      const validStatuses = ["planned", "in-progress", "done", "blocked"];
      if (!validStatuses.includes(params.status as string)) {
        return { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` };
      }

      const result = db.run(
        `UPDATE features SET status = ?, updated_at = datetime('now')
         WHERE project_id = ? AND name LIKE ?`,
        [params.status, proj.id, `%${params.feature_name}%`],
      );

      if (result.changes === 0) {
        return { error: `No feature matching "${params.feature_name}" found in project "${params.project}"` };
      }

      return { ok: true, changes: result.changes, feature_name: params.feature_name, status: params.status };
    } finally {
      db.close();
    }
  },

  pmm_decision_add: (params) => {
    const db = openDb();
    try {
      const proj = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
      if (!proj) return { error: `Project "${params.project}" not found` };

      const result = db.run(
        `INSERT INTO decisions (project_id, question, decision, rationale, status, created_at)
         VALUES (?, ?, ?, ?, 'decided', datetime('now'))`,
        [
          proj.id,
          params.question as string,
          params.decision as string,
          (params.rationale as string) || null,
        ],
      );

      return { ok: true, decision_id: result.lastInsertRowid, project: params.project };
    } finally {
      db.close();
    }
  },

  pmm_roadblock_add: (params) => {
    const db = openDb();
    try {
      const proj = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
      if (!proj) return { error: `Project "${params.project}" not found` };

      const validSeverities = ["low", "medium", "high", "critical"];
      if (!validSeverities.includes(params.severity as string)) {
        return { error: `Invalid severity. Must be one of: ${validSeverities.join(", ")}` };
      }

      const result = db.run(
        `INSERT INTO roadblocks (project_id, description, severity, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [proj.id, params.description as string, params.severity as string],
      );

      return { ok: true, roadblock_id: result.lastInsertRowid, project: params.project };
    } finally {
      db.close();
    }
  },

  pmm_alert_create: (params) => {
    const db = openDb();
    try {
      const proj = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.project]) as any;
      if (!proj) return { error: `Project "${params.project}" not found` };

      const validSeverities = ["info", "warning", "critical"];
      if (!validSeverities.includes(params.severity as string)) {
        return { error: `Invalid severity. Must be one of: ${validSeverities.join(", ")}` };
      }

      const result = db.run(
        `INSERT INTO alerts (project_id, severity, message, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [proj.id, params.severity as string, params.message as string],
      );

      return { ok: true, alert_id: result.lastInsertRowid, project: params.project };
    } finally {
      db.close();
    }
  },

  // ── Swarm Execution Handlers (v4.3) ─────────────────────

  pmm_swarm_deploy: async (params) => {
    const { buildDeployPlan } = await import("../execution/deploy");
    const db = openDb();
    try {
      const plan = buildDeployPlan(db, params.project as string, {
        layer: params.layer as number | undefined,
        max_parallel: (params.max_parallel as number) || 5,
        dry_run: (params.dry_run as boolean) || false,
        model_override: params.model_override as "haiku" | "sonnet" | "opus" | undefined,
      });
      return plan;
    } finally {
      db.close();
    }
  },

  pmm_swarm_status_live: async (params) => {
    const { getSwarmStatus } = await import("../execution/deploy");
    const db = openDb();
    try {
      return getSwarmStatus(db, params.project as string);
    } finally {
      db.close();
    }
  },

  pmm_swarm_collect: async (params) => {
    const { advanceSwarm } = await import("../execution/deploy");
    const db = openDb();
    try {
      const workerIds = (params.completed_worker_ids as number[]) || [];
      const rawSummaries = (params.summaries as Record<string, string>) || {};
      // Convert string keys to number keys
      const summaries: Record<number, string> = {};
      for (const [k, v] of Object.entries(rawSummaries)) summaries[Number(k)] = v;
      return advanceSwarm(db, params.project as string, {
        completed_worker_ids: workerIds,
        summaries,
        max_parallel: (params.max_parallel as number) || 5,
      });
    } finally {
      db.close();
    }
  },
};

// ── Server Main Loop ─────────────────────────────────────

let buffer = "";
process.stdin.setEncoding("utf-8");

process.stdin.on("data", async (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req: JsonRpcRequest = JSON.parse(line);

      // MCP Initialize
      if (req.method === "initialize") {
        respond(req.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "pmm", version: "4.2.0" },
        });
        continue;
      }

      // MCP notifications (no response)
      if (req.method === "notifications/initialized" || req.method?.startsWith("notifications/")) {
        continue;
      }

      // Tools list
      if (req.method === "tools/list") {
        respond(req.id, { tools });
        continue;
      }

      // Tool call
      if (req.method === "tools/call") {
        const toolName = (req.params as any)?.name;
        const toolArgs = (req.params as any)?.arguments || {};
        const handler = handlers[toolName];

        if (!handler) {
          error(req.id, -32601, `Unknown tool: ${toolName}`);
          continue;
        }

        try {
          const result = await handler(toolArgs);
          respond(req.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (e: any) {
          respond(req.id, { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] });
        }
        continue;
      }

      // Unknown method
      error(req.id, -32601, `Unknown method: ${req.method}`);
    } catch {
      // Invalid JSON, skip
    }
  }
});

process.stderr.write("[pmm-mcp] PMM MCP Server started (stdio)\n");
