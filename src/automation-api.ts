/**
 * PMM Automation API — CRUD Layer
 * ================================
 * HTTP API for querying and mutating the automation database. Designed to feed
 * a real-time Claude Code webapp frontend for visualization, monitoring, and control.
 *
 * Usage: bun src/pmm/automation-api.ts
 * Port: 4200 (default, override with PORT env)
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";

const DB_PATH = join(import.meta.dir, "..", "..", "PMM", "pmm.db");
const PORT = parseInt(process.env.AUTOMATION_API_PORT || "4200");

function openDb(): Database {
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

// ─── Helpers ────────────────────────────────────────────────

function queryAll(db: Database, sql: string, params: any[] = []): any[] {
  return db.query(sql).all(...params);
}

function queryOne(db: Database, sql: string, params: any[] = []): any | null {
  return db.query(sql).get(...params);
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

async function parseBody(req: Request): Promise<Record<string, any>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// ─── Route registry ─────────────────────────────────────────
// Key format: "METHOD:/path" — e.g. "GET:/api/projects", "POST:/api/projects"

type RouteHandler = (
  db: Database,
  params: Record<string, string>,
  body?: Record<string, any>,
) => Response | Promise<Response>;

const routes: Record<string, RouteHandler> = {
  // ═══════════════════════════════════════════════════════════
  //  GET — Read
  // ═══════════════════════════════════════════════════════════

  // ── Dashboard Summary ────────────────────────────────────
  "GET:/api/summary": (db) => {
    const projects = queryAll(
      db,
      "SELECT name, status, phase, priority, health, tech_stack FROM projects ORDER BY priority",
    );
    const toolCount = (queryOne(db, "SELECT COUNT(*) as c FROM tooling") as any).c;
    const mcpCount = (queryOne(db, "SELECT COUNT(*) as c FROM mcp_servers") as any).c;
    const pipelineCount = (queryOne(db, "SELECT COUNT(*) as c FROM pipelines") as any).c;
    const capturesDone = (
      queryOne(db, "SELECT COUNT(*) as c FROM protocol_captures WHERE status = 'captured'") as any
    ).c;
    const capturesTotal = (queryOne(db, "SELECT COUNT(*) as c FROM protocol_captures") as any).c;
    const hooksCount = (queryOne(db, "SELECT COUNT(*) as c FROM hooks") as any).c;
    const edges = queryAll(db, "SELECT from_tool, to_tool, via FROM integration_edges");

    return json({
      projects: projects.map((p: any) => ({
        ...p,
        tech_stack: JSON.parse(p.tech_stack || "[]"),
      })),
      counts: {
        tools: toolCount,
        mcpServers: mcpCount,
        pipelines: pipelineCount,
        hooks: hooksCount,
        captures: `${capturesDone}/${capturesTotal}`,
      },
      edges,
    });
  },

  // ── Projects ─────────────────────────────────────────────
  "GET:/api/projects": (db) => {
    const rows = queryAll(db, "SELECT * FROM projects ORDER BY priority");
    return json(rows.map((r: any) => ({ ...r, tech_stack: JSON.parse(r.tech_stack || "[]") })));
  },

  "GET:/api/projects/:name": (db, params) => {
    const name = params.name;
    const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [name]) as any;
    if (!project) return json({ error: "Not found" }, 404);

    const tools = queryAll(
      db,
      "SELECT * FROM tooling WHERE project_id = ? ORDER BY priority, category",
      [project.id],
    );
    const pipelines = queryAll(db, "SELECT * FROM pipelines WHERE project_id = ?", [project.id]);
    for (const p of pipelines) {
      p.steps = queryAll(
        db,
        "SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY step_order",
        [p.id],
      );
    }
    const captures = queryAll(
      db,
      "SELECT * FROM protocol_captures WHERE project_id = ? ORDER BY provider",
      [project.id],
    );
    const skills = queryAll(db, "SELECT * FROM skills WHERE project_id = ?", [project.id]);
    const configs = queryAll(db, "SELECT * FROM automation_configs WHERE project_id = ?", [
      project.id,
    ]);

    return json({
      ...project,
      tech_stack: JSON.parse(project.tech_stack || "[]"),
      tools,
      pipelines,
      captures,
      skills,
      configs,
    });
  },

  // ── Tools ────────────────────────────────────────────────
  "GET:/api/tools": (db) => {
    const rows = queryAll(
      db,
      `
      SELECT t.*, p.name as project_name
      FROM tooling t
      JOIN projects p ON t.project_id = p.id
      ORDER BY t.priority, t.category
    `,
    );
    return json(rows);
  },

  // ── Pipelines ────────────────────────────────────────────
  "GET:/api/pipelines": (db) => {
    const pipelines = queryAll(
      db,
      `
      SELECT p.*, pr.name as project_name
      FROM pipelines p
      JOIN projects pr ON p.project_id = pr.id
      ORDER BY pr.priority, p.category
    `,
    );
    for (const p of pipelines) {
      p.steps = queryAll(
        db,
        "SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY step_order",
        [p.id],
      );
    }
    return json(pipelines);
  },

  // ── MCP Servers ──────────────────────────────────────────
  "GET:/api/mcp-servers": (db) => {
    const rows = queryAll(
      db,
      `
      SELECT m.*, p.name as project_name
      FROM mcp_servers m
      JOIN projects p ON m.project_id = p.id
      ORDER BY m.status, m.name
    `,
    );
    return json(rows);
  },

  // ── Protocol Captures ────────────────────────────────────
  "GET:/api/captures": (db) => {
    const rows = queryAll(
      db,
      `
      SELECT c.*, p.name as project_name
      FROM protocol_captures c
      JOIN projects p ON c.project_id = p.id
      ORDER BY c.created_at DESC
    `,
    );
    return json(rows);
  },

  // ── Integration Graph ────────────────────────────────────
  "GET:/api/integration-graph": (db) => {
    const edges = queryAll(
      db,
      `
      SELECT ie.*, p.name as project_name
      FROM integration_edges ie
      JOIN projects p ON ie.project_id = p.id
    `,
    );
    const nodeSet = new Set<string>();
    for (const e of edges) {
      nodeSet.add(e.from_tool);
      nodeSet.add(e.to_tool);
    }
    const nodes = [...nodeSet].map((name) => {
      const tool = queryOne(
        db,
        "SELECT category, status, priority FROM tooling WHERE tool_name = ?",
        [name],
      ) as any;
      return { name, ...(tool || {}) };
    });
    return json({ nodes, edges });
  },

  // ── Skills ───────────────────────────────────────────────
  "GET:/api/skills": (db) => {
    const rows = queryAll(
      db,
      `
      SELECT s.*, p.name as project_name
      FROM skills s
      JOIN projects p ON s.project_id = p.id
      ORDER BY s.name
    `,
    );
    return json(rows);
  },

  // ── Hooks ────────────────────────────────────────────────
  "GET:/api/hooks": (db) => {
    const rows = queryAll(
      db,
      `
      SELECT h.*, p.name as project_name
      FROM hooks h
      JOIN projects p ON h.project_id = p.id
      ORDER BY h.event_name
    `,
    );
    return json(rows);
  },

  // ── Health ───────────────────────────────────────────────
  "GET:/api/health": (_db) => {
    return json({
      status: "ok",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: Date.now(),
    });
  },

  // ═══════════════════════════════════════════════════════════
  //  POST — Create
  // ═══════════════════════════════════════════════════════════

  "POST:/api/projects": async (db, _params, body) => {
    const { name, status, phase, priority, repo_path, tech_stack, health } = body || {};
    if (!name) return json({ error: "name is required" }, 400);

    const existing = queryOne(db, "SELECT id FROM projects WHERE name = ?", [name]);
    if (existing) return json({ error: `Project "${name}" already exists` }, 409);

    db.run(
      `INSERT INTO projects (name, status, phase, priority, repo_path, tech_stack, health)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        status || "active",
        phase || "define",
        priority || "medium",
        repo_path || null,
        JSON.stringify(tech_stack || []),
        health || "healthy",
      ],
    );
    const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [name]) as any;
    return json({ ...project, tech_stack: JSON.parse(project.tech_stack || "[]") }, 201);
  },

  "POST:/api/tools": async (db, _params, body) => {
    const {
      project_name,
      tool_name,
      category,
      config_path,
      description,
      pricing,
      setup_effort,
      priority,
      docs_url,
      installed_version,
    } = body || {};
    if (!project_name || !tool_name)
      return json({ error: "project_name and tool_name are required" }, 400);

    const project = queryOne(db, "SELECT id FROM projects WHERE name = ?", [project_name]) as any;
    if (!project) return json({ error: `Project "${project_name}" not found` }, 404);

    db.run(
      `INSERT OR REPLACE INTO tooling (project_id, tool_name, category, config_path, status, description, pricing, setup_effort, priority, docs_url, installed_version)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      [
        project.id,
        tool_name,
        category || null,
        config_path || null,
        description || null,
        pricing || "free",
        setup_effort || "low",
        priority || "medium",
        docs_url || null,
        installed_version || null,
      ],
    );
    const tool = queryOne(db, "SELECT * FROM tooling WHERE project_id = ? AND tool_name = ?", [
      project.id,
      tool_name,
    ]);
    return json(tool, 201);
  },

  // ═══════════════════════════════════════════════════════════
  //  PUT — Update
  // ═══════════════════════════════════════════════════════════

  "PUT:/api/projects/:name": async (db, params, body) => {
    const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [params.name]) as any;
    if (!project) return json({ error: "Not found" }, 404);

    const { status, phase, priority, repo_path, tech_stack, health } = body || {};
    const updates: string[] = [];
    const values: any[] = [];

    if (status !== undefined) {
      updates.push("status = ?");
      values.push(status);
    }
    if (phase !== undefined) {
      updates.push("phase = ?");
      values.push(phase);
    }
    if (priority !== undefined) {
      updates.push("priority = ?");
      values.push(priority);
    }
    if (repo_path !== undefined) {
      updates.push("repo_path = ?");
      values.push(repo_path);
    }
    if (tech_stack !== undefined) {
      updates.push("tech_stack = ?");
      values.push(JSON.stringify(tech_stack));
    }
    if (health !== undefined) {
      updates.push("health = ?");
      values.push(health);
    }

    if (updates.length === 0) return json({ error: "No fields to update" }, 400);

    values.push(params.name);
    db.run(`UPDATE projects SET ${updates.join(", ")} WHERE name = ?`, values);

    const updated = queryOne(db, "SELECT * FROM projects WHERE name = ?", [params.name]) as any;
    return json({ ...updated, tech_stack: JSON.parse(updated.tech_stack || "[]") });
  },

  // ═══════════════════════════════════════════════════════════
  //  DELETE
  // ═══════════════════════════════════════════════════════════

  "DELETE:/api/projects/:name": (db, params) => {
    const project = queryOne(db, "SELECT id FROM projects WHERE name = ?", [params.name]) as any;
    if (!project) return json({ error: "Not found" }, 404);

    // Cascade: delete related records
    db.run("DELETE FROM tooling WHERE project_id = ?", [project.id]);
    db.run("DELETE FROM mcp_servers WHERE project_id = ?", [project.id]);
    db.run("DELETE FROM skills WHERE project_id = ?", [project.id]);
    db.run("DELETE FROM hooks WHERE project_id = ?", [project.id]);
    db.run("DELETE FROM protocol_captures WHERE project_id = ?", [project.id]);
    db.run("DELETE FROM automation_configs WHERE project_id = ?", [project.id]);
    db.run("DELETE FROM integration_edges WHERE project_id = ?", [project.id]);
    // Pipelines and their steps
    const pipelines = queryAll(db, "SELECT id FROM pipelines WHERE project_id = ?", [project.id]);
    for (const p of pipelines) {
      db.run("DELETE FROM pipeline_steps WHERE pipeline_id = ?", [p.id]);
    }
    db.run("DELETE FROM pipelines WHERE project_id = ?", [project.id]);
    db.run("DELETE FROM projects WHERE id = ?", [project.id]);

    return json({ deleted: params.name });
  },
};

// ─── Route matching ─────────────────────────────────────────

function matchRoute(
  method: string,
  pathname: string,
): { handler: RouteHandler; params: Record<string, string> } | null {
  const key = `${method}:${pathname}`;

  // Exact match
  if (routes[key]) return { handler: routes[key]!, params: {} };

  // Parameterized match within same HTTP method
  for (const [pattern, handler] of Object.entries(routes)) {
    const [patMethod, patPath] = pattern.split(":", 2) as [string, string];
    if (patMethod !== method) continue;
    if (!patPath.includes(":")) continue;

    const regex = new RegExp("^" + patPath.replace(/:[^/]+/g, "([^/]+)") + "$");
    const match = pathname.match(regex);
    if (match) {
      const paramNames = [...patPath.matchAll(/:([^/]+)/g)].map((m) => m[1]);
      const params: Record<string, string> = {};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1]!;
      });
      return { handler, params };
    }
  }
  return null;
}

// ─── Server ─────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === "OPTIONS") return cors();

    const url = new URL(req.url);
    const match = matchRoute(req.method, url.pathname);

    if (!match) {
      const getKeys = Object.keys(routes).filter((k) => k.startsWith("GET:"));
      return json({ error: "Not found", available_endpoints: getKeys }, 404);
    }

    const db = openDb();
    try {
      const body = req.method === "POST" || req.method === "PUT" ? await parseBody(req) : undefined;
      return await match.handler(db, match.params, body);
    } catch (err: any) {
      return json({ error: err.message }, 500);
    } finally {
      db.close();
    }
  },
});

console.log(`
╔══════════════════════════════════════════╗
║   PMM Automation API (CRUD)             ║
║──────────────────────────────────────────║
║  URL      : http://localhost:${PORT}        ║
║  Database : ${DB_PATH}
║                                          ║
║  GET  /api/summary     Dashboard         ║
║  GET  /api/projects    List projects     ║
║  POST /api/projects    Create project    ║
║  GET  /api/projects/:name  Get project   ║
║  PUT  /api/projects/:name  Update project║
║  DELETE /api/projects/:name Delete       ║
║  GET  /api/tools       List tools        ║
║  POST /api/tools       Create tool       ║
║  GET  /api/pipelines   List pipelines    ║
║  GET  /api/captures    RE capture status ║
║  GET  /api/mcp-servers MCP server status ║
║  GET  /api/skills      List skills       ║
║  GET  /api/hooks       List hooks        ║
║  GET  /api/integration-graph  For vis    ║
║  GET  /api/health      API health        ║
╚══════════════════════════════════════════╝
`);
