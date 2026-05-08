import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const DB_PATH = join(ROOT, "PMM", "pmm.db");
const PORT = parseInt(process.env.PMM_PORT || "9999");

function openDB(): Database {
  if (!existsSync(DB_PATH))
    throw new Error(`PMM database not found at ${DB_PATH}. Run: bun run scripts/init-pmm.ts`);
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

// ── SSE client management ──
const sseClients = new Set<ReadableStreamDefaultController>();

function broadcast(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(ctrl);
    }
  }
}

// ── Query helpers ──
function queryAll(db: Database, sql: string, ...params: any[]) {
  return db.query(sql).all(...params);
}

function queryOne(db: Database, sql: string, ...params: any[]) {
  return db.query(sql).get(...params);
}

// ── API: Full project detail ──
function getProjectDetail(db: Database, id: number) {
  const project = queryOne(db, "SELECT * FROM projects WHERE id = ?", id);
  if (!project) return null;
  return {
    ...project,
    tech_stack: JSON.parse((project as any).tech_stack || "[]"),
    milestones: queryAll(db, "SELECT * FROM milestones WHERE project_id = ? ORDER BY due", id),
    decisions: queryAll(
      db,
      "SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC",
      id,
    ),
    tasks: queryAll(
      db,
      "SELECT * FROM atomic_tasks WHERE project_id = ? ORDER BY status, created_at",
      id,
    ),
    features: queryAll(
      db,
      "SELECT * FROM features WHERE project_id = ? ORDER BY priority, created_at",
      id,
    ),
    roadblocks: queryAll(
      db,
      "SELECT * FROM roadblocks WHERE project_id = ? AND resolved_at IS NULL ORDER BY severity",
      id,
    ),
    success_criteria: queryAll(db, "SELECT * FROM success_criteria WHERE project_id = ?", id),
    tooling: queryAll(db, "SELECT * FROM tooling WHERE project_id = ?", id),
    dependencies: queryAll(
      db,
      `SELECT d.*, p.name as from_name, p2.name as to_name
       FROM dependencies d
       JOIN projects p ON d.from_project_id = p.id
       JOIN projects p2 ON d.to_project_id = p2.id
       WHERE d.from_project_id = ? OR d.to_project_id = ?`,
      id,
      id,
    ),
    sessions: queryAll(
      db,
      "SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10",
      id,
    ),
    notes: queryAll(db, "SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC", id),
  };
}

// ── Bun HTTP server ──
Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS for local dev
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // ── SSE stream ──
    if (path === "/api/pmm/stream") {
      let ctrl: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(controller) {
          ctrl = controller;
          sseClients.add(ctrl);
        },
        cancel() {
          sseClients.delete(ctrl);
        },
      });
      return new Response(stream, {
        headers: {
          ...headers,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // ── GET /api/pmm/projects ──
    if (path === "/api/pmm/projects" && req.method === "GET") {
      try {
        const db = openDB();
        const projects = queryAll(
          db,
          `SELECT * FROM projects ORDER BY
           CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, name`,
        );
        const data = projects.map((p: any) => ({
          ...p,
          tech_stack: JSON.parse(p.tech_stack || "[]"),
          milestone_count: (
            queryOne(db, "SELECT COUNT(*) as c FROM milestones WHERE project_id = ?", p.id) as any
          ).c,
          task_count: (
            queryOne(db, "SELECT COUNT(*) as c FROM atomic_tasks WHERE project_id = ?", p.id) as any
          ).c,
          open_roadblocks: (
            queryOne(
              db,
              "SELECT COUNT(*) as c FROM roadblocks WHERE project_id = ? AND resolved_at IS NULL",
              p.id,
            ) as any
          ).c,
          last_session: (
            queryOne(
              db,
              "SELECT MAX(started_at) as s FROM sessions WHERE project_id = ?",
              p.id,
            ) as any
          ).s,
        }));
        db.close();
        return Response.json(data, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/portfolio ──
    if (path === "/api/pmm/portfolio" && req.method === "GET") {
      try {
        const db = openDB();

        // Fetch all nodes
        const allNodes = queryAll(
          db,
          `
          SELECT * FROM portfolio_nodes ORDER BY sort_order, name
        `,
        ) as any[];

        // Fetch all projects with their node_id + aggregate counts
        const allProjects = queryAll(
          db,
          `
          SELECT p.*,
            (SELECT COUNT(*) FROM milestones WHERE project_id = p.id) as milestone_count,
            (SELECT COUNT(*) FROM atomic_tasks WHERE project_id = p.id) as task_count,
            (SELECT COUNT(*) FROM roadblocks WHERE project_id = p.id AND resolved_at IS NULL) as open_roadblocks,
            (SELECT MAX(started_at) FROM sessions WHERE project_id = p.id) as last_session
          FROM projects p
          ORDER BY
            CASE p.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
            p.name
        `,
        ) as any[];

        db.close();

        // Build lookup: nodeId -> projects
        const projectsByNode: Record<number, any[]> = {};
        const unlinkedProjects: any[] = [];
        for (const p of allProjects) {
          const nodeId = p.node_id;
          if (nodeId) {
            if (!projectsByNode[nodeId]) projectsByNode[nodeId] = [];
            projectsByNode[nodeId].push({
              ...p,
              tech_stack: JSON.parse(p.tech_stack || "[]"),
              last_active_days: p.last_session
                ? Math.floor((Date.now() - new Date(p.last_session + "Z").getTime()) / 86400000)
                : null,
            });
          } else {
            unlinkedProjects.push({
              ...p,
              tech_stack: JSON.parse(p.tech_stack || "[]"),
              last_active_days: p.last_session
                ? Math.floor((Date.now() - new Date(p.last_session + "Z").getTime()) / 86400000)
                : null,
            });
          }
        }

        // Build lookup: nodeId -> child nodes
        const childrenByParent: Record<number, any[]> = {};
        const roots: any[] = [];
        for (const n of allNodes) {
          if (n.parent_id) {
            if (!childrenByParent[n.parent_id]) childrenByParent[n.parent_id] = [];
            childrenByParent[n.parent_id].push(n);
          } else {
            roots.push(n);
          }
        }

        // Recursive tree builder
        function buildTree(node: any): any {
          const children = (childrenByParent[node.id] || []).map(buildTree);
          const projects = projectsByNode[node.id] || [];
          return {
            ...node,
            children,
            projects,
            project_count:
              projects.length + children.reduce((sum: number, c: any) => sum + c.project_count, 0),
          };
        }

        const tree = roots.map(buildTree);

        return Response.json(
          {
            tree,
            unlinked: unlinkedProjects,
            unlinked_count: unlinkedProjects.length,
          },
          { headers },
        );
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/projects/:id ──
    const projMatch = path.match(/^\/api\/pmm\/projects\/(\d+)$/);
    if (projMatch && req.method === "GET") {
      try {
        const db = openDB();
        const detail = getProjectDetail(db, parseInt(projMatch[1]));
        db.close();
        if (!detail) return Response.json({ error: "Not found" }, { status: 404, headers });
        return Response.json(detail, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/notes ──
    if (path === "/api/pmm/notes" && req.method === "GET") {
      try {
        const db = openDB();
        const projectId = url.searchParams.get("project_id");
        const targetType = url.searchParams.get("target_type");
        const targetId = url.searchParams.get("target_id");

        let sql = "SELECT * FROM notes WHERE 1=1";
        const params: any[] = [];
        if (projectId) {
          sql += " AND project_id = ?";
          params.push(projectId);
        }
        if (targetType) {
          sql += " AND target_type = ?";
          params.push(targetType);
        }
        if (targetId) {
          sql += " AND target_id = ?";
          params.push(targetId);
        }
        sql += " ORDER BY updated_at DESC";

        const notes = queryAll(db, sql, ...params);
        db.close();
        return Response.json(notes, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── POST /api/pmm/notes ──
    if (path === "/api/pmm/notes" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        const db = openDB();
        const result = db.run(
          `INSERT INTO notes (project_id, target_type, target_id, title, content, tags)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            body.project_id,
            body.target_type || "standalone",
            body.target_id || null,
            body.title,
            body.content || "",
            body.tags || "[]",
          ],
        );
        const note = queryOne(db, "SELECT * FROM notes WHERE id = ?", result.lastInsertRowid);
        db.close();
        broadcast("note:created", note);
        return Response.json(note, { status: 201, headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── PUT /api/pmm/notes/:id ──
    const noteMatch = path.match(/^\/api\/pmm\/notes\/(\d+)$/);
    if (noteMatch && req.method === "PUT") {
      try {
        const body = (await req.json()) as any;
        const db = openDB();
        db.run(
          `UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`,
          [body.title, body.content, body.tags, noteMatch[1]],
        );
        const note = queryOne(db, "SELECT * FROM notes WHERE id = ?", noteMatch[1]);
        db.close();
        broadcast("note:updated", note);
        return Response.json(note, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── DELETE /api/pmm/notes/:id ──
    if (noteMatch && req.method === "DELETE") {
      try {
        const db = openDB();
        db.run("DELETE FROM notes WHERE id = ?", [noteMatch[1]]);
        db.close();
        broadcast("note:deleted", { id: parseInt(noteMatch[1]) });
        return Response.json({ ok: true }, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── POST /api/pmm/update ──
    if (path === "/api/pmm/update" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        const { table, id, fields } = body;
        const validTables = [
          "projects",
          "milestones",
          "decisions",
          "atomic_tasks",
          "features",
          "roadblocks",
          "success_criteria",
          "tooling",
          "sessions",
          "dependencies",
        ];
        if (!validTables.includes(table))
          return Response.json({ error: "Invalid table" }, { status: 400, headers });

        const db = openDB();
        const sets = Object.keys(fields)
          .map((k) => `${k} = ?`)
          .join(", ");
        const values = Object.values(fields);
        db.run(`UPDATE ${table} SET ${sets}, updated_at = datetime('now') WHERE id = ?`, [
          ...values,
          id,
        ]);

        const updated = queryOne(db, `SELECT * FROM ${table} WHERE id = ?`, id);
        db.close();
        broadcast("data:updated", { table, id, updated });
        return Response.json(updated, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── POST /api/pmm/agent ──
    if (path === "/api/pmm/agent" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        const { agent, params } = body;
        broadcast("agent:started", { agent, params });

        // Spawn claude in headless mode for agent analysis
        const prompt = buildAgentPrompt(agent, params);
        const proc = Bun.spawn(["claude", "--print", "--model", "haiku", prompt], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        let result: any;
        try {
          // Try to parse JSON from the output
          const jsonMatch = output.match(/\{[\s\S]*\}/);
          result = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: output.slice(0, 500) };
        } catch {
          result = { raw: output.slice(0, 500) };
        }

        // Write results to DB if applicable
        if (agent === "impact-analyzer" && result.impacts) {
          const db = openDB();
          for (const impact of result.impacts) {
            db.run(
              `INSERT OR IGNORE INTO decision_impacts (decision_id, affected_table, affected_id, impact_type) VALUES (?, ?, ?, ?)`,
              [params.decision_id, impact.table, impact.id, impact.type],
            );
          }
          if (result.alerts) {
            for (const alert of result.alerts) {
              db.run(`INSERT INTO alerts (project_id, severity, message) VALUES (?, ?, ?)`, [
                params.project_id,
                alert.severity,
                alert.message,
              ]);
            }
          }
          db.close();
          broadcast("agent:completed", { agent, result });
        } else if (agent === "health-scorer" && result.scores) {
          const db = openDB();
          for (const [projectId, health] of Object.entries(result.scores)) {
            db.run("UPDATE projects SET health = ? WHERE id = ?", [health, projectId]);
          }
          db.close();
          broadcast("agent:completed", { agent, result });
        } else {
          broadcast("agent:completed", { agent, result });
        }

        return Response.json({ agent, output: result, stderr }, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/patterns ──
    if (path === "/api/pmm/patterns" && req.method === "GET") {
      try {
        const db = openDB();
        const patterns = queryAll(db, "SELECT * FROM patterns ORDER BY confidence DESC");
        db.close();
        return Response.json(patterns, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/alerts ──
    if (path === "/api/pmm/alerts" && req.method === "GET") {
      try {
        const db = openDB();
        const alerts = queryAll(
          db,
          "SELECT a.*, p.name as project_name FROM alerts a JOIN projects p ON a.project_id = p.id WHERE a.resolved_at IS NULL ORDER BY a.created_at DESC",
        );
        db.close();
        return Response.json(alerts, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/workers ──
    const workersMatch = path.match(/^\/api\/pmm\/workers\/?$/);
    if (workersMatch && req.method === "GET") {
      try {
        const db = openDB();
        const statusFilter = url.searchParams.get("status");
        let workers;
        if (statusFilter) {
          workers = queryAll(
            db,
            `SELECT w.*, p.name as project_name, a.name as agent_name
             FROM agent_workers w
             LEFT JOIN projects p ON w.project_id = p.id
             LEFT JOIN subagents a ON w.subagent_id = a.id
             WHERE w.status = ?
             ORDER BY w.started_at DESC LIMIT 50`,
            [statusFilter],
          );
        } else {
          workers = queryAll(
            db,
            `SELECT w.*, p.name as project_name, a.name as agent_name
             FROM agent_workers w
             LEFT JOIN projects p ON w.project_id = p.id
             LEFT JOIN subagents a ON w.subagent_id = a.id
             ORDER BY w.started_at DESC LIMIT 50`,
          );
        }
        db.close();
        return Response.json(workers, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/drift ──
    if (path === "/api/pmm/drift" && req.method === "GET") {
      try {
        const db = openDB();
        // Count registrations from key tables
        const subagentCount = (queryOne(db, "SELECT COUNT(*) as c FROM subagents") as any).c;
        const skillCount = (queryOne(db, "SELECT COUNT(*) as c FROM skills") as any).c;
        const hookCount = (queryOne(db, "SELECT COUNT(*) as c FROM hooks") as any).c;
        const pipelineCount = (queryOne(db, "SELECT COUNT(*) as c FROM pipelines") as any).c;

        // Build gap report
        const gaps: { type: string; name: string; detail: string; severity: string }[] = [];

        // Check for force-registered agents that may be missing
        const forceRegistered = [
          "architect",
          "executor-high",
          "code-reviewer",
          "critic",
          "planner",
          "explore-high",
          "security-reviewer",
          "designer-high",
          "qa-tester-high",
          "pmm-agent",
          "pmm-onboarder",
          "pmm-health-scorer",
          "pmm-sync",
        ];
        for (const name of forceRegistered) {
          const found = queryOne(db, "SELECT id FROM subagents WHERE name = ?", [name]);
          if (!found) {
            gaps.push({
              type: "agent",
              name,
              detail: "Force-registered agent not in database",
              severity: "high",
            });
          }
        }

        db.close();
        return Response.json(
          {
            registered: {
              subagents: subagentCount,
              skills: skillCount,
              hooks: hookCount,
              pipelines: pipelineCount,
            },
            gaps,
            total_gaps: gaps.length,
            timestamp: new Date().toISOString(),
          },
          { headers },
        );
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/config ──
    if (path === "/api/pmm/config" && req.method === "GET") {
      try {
        const db = openDB();
        const configs = queryAll(db, "SELECT * FROM automation_configs ORDER BY key");
        db.close();
        return Response.json(configs, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── POST /api/pmm/session-end ──
    if (path === "/api/pmm/session-end" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        const db = openDB();
        db.run(
          `INSERT INTO sessions (project_id, started_at, ended_at, summary, git_commits, checkpoint_id)
           VALUES (?, ?, datetime('now'), ?, ?, ?)`,
          [
            body.project_id,
            body.started_at,
            body.summary || "",
            body.git_commits || "",
            body.checkpoint_id || null,
          ],
        );
        db.run("UPDATE projects SET last_session = datetime('now') WHERE id = ?", [
          body.project_id,
        ]);
        db.close();
        broadcast("session:ended", body);
        return Response.json({ ok: true }, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── GET /api/pmm/nodes ──
    if (path === "/api/pmm/nodes" && req.method === "GET") {
      try {
        const db = openDB();
        const type = url.searchParams.get("type");
        const status = url.searchParams.get("status");
        const parentId = url.searchParams.get("parent_id");
        let sql = "SELECT * FROM portfolio_nodes WHERE 1=1";
        const params: any[] = [];
        if (type) {
          sql += " AND type = ?";
          params.push(type);
        }
        if (status) {
          sql += " AND status = ?";
          params.push(status);
        }
        if (parentId) {
          sql += " AND parent_id = ?";
          params.push(parseInt(parentId));
        }
        sql += " ORDER BY sort_order, name";
        const nodes = queryAll(db, sql, ...params);
        db.close();
        return Response.json(nodes, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── POST /api/pmm/nodes ──
    if (path === "/api/pmm/nodes" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        const db = openDB();
        const result = db.run(
          `INSERT INTO portfolio_nodes (name, type, parent_id, status, description, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            body.name,
            body.type || "component",
            body.parent_id || null,
            body.status || "planned",
            body.description || null,
            body.sort_order || null,
          ],
        );
        const node = queryOne(
          db,
          "SELECT * FROM portfolio_nodes WHERE id = ?",
          result.lastInsertRowid,
        );
        db.close();
        broadcast("data:updated", {
          table: "portfolio_nodes",
          id: result.lastInsertRowid,
          action: "created",
        });
        return Response.json(node, { status: 201, headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── PUT /api/pmm/nodes/:id ──
    const nodeMatch = path.match(/^\/api\/pmm\/nodes\/(\d+)$/);
    if (nodeMatch && req.method === "PUT") {
      try {
        const body = (await req.json()) as any;
        const db = openDB();
        const allowed = ["name", "status", "parent_id", "description", "sort_order", "target_date"];
        const sets: string[] = [];
        const values: any[] = [];
        for (const key of allowed) {
          if (body[key] !== undefined) {
            sets.push(`${key} = ?`);
            values.push(body[key]);
          }
        }
        if (sets.length === 0) {
          db.close();
          return Response.json({ error: "No fields to update" }, { status: 400, headers });
        }
        sets.push("updated_at = datetime('now')");
        db.run(`UPDATE portfolio_nodes SET ${sets.join(", ")} WHERE id = ?`, [
          ...values,
          parseInt(nodeMatch[1]),
        ]);
        const node = queryOne(
          db,
          "SELECT * FROM portfolio_nodes WHERE id = ?",
          parseInt(nodeMatch[1]),
        );
        db.close();
        broadcast("data:updated", {
          table: "portfolio_nodes",
          id: parseInt(nodeMatch[1]),
          action: "updated",
        });
        return Response.json(node, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── DELETE /api/pmm/nodes/:id ──
    if (nodeMatch && req.method === "DELETE") {
      try {
        const db = openDB();
        const nodeId = parseInt(nodeMatch[1]);

        // Guard: check for children
        const childCount = (
          queryOne(
            db,
            "SELECT COUNT(*) as c FROM portfolio_nodes WHERE parent_id = ?",
            nodeId,
          ) as any
        ).c;
        if (childCount > 0) {
          db.close();
          return Response.json(
            { error: "Node has child nodes. Remove them first." },
            { status: 409, headers },
          );
        }

        // Guard: check for linked projects
        const projCount = (
          queryOne(db, "SELECT COUNT(*) as c FROM projects WHERE node_id = ?", nodeId) as any
        ).c;
        if (projCount > 0) {
          db.close();
          return Response.json(
            { error: "Node has linked projects. Unlink or reassign them first." },
            { status: 409, headers },
          );
        }

        db.run("DELETE FROM portfolio_nodes WHERE id = ?", [nodeId]);
        db.close();
        broadcast("data:updated", { table: "portfolio_nodes", id: nodeId, action: "deleted" });
        return Response.json({ ok: true }, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    // ── PUT /api/pmm/projects/:id/reparent ──
    const reparentMatch = path.match(/^\/api\/pmm\/projects\/(\d+)\/reparent$/);
    if (reparentMatch && req.method === "PUT") {
      try {
        const body = (await req.json()) as any;
        const db = openDB();
        const projectId = parseInt(reparentMatch[1]);
        const existing = queryOne(db, "SELECT id FROM projects WHERE id = ?", projectId);
        if (!existing) {
          db.close();
          return Response.json({ error: "Project not found" }, { status: 404, headers });
        }
        db.run("UPDATE projects SET node_id = ?, updated_at = datetime('now') WHERE id = ?", [
          body.node_id || null,
          projectId,
        ]);
        const project = queryOne(db, "SELECT * FROM projects WHERE id = ?", projectId);
        db.close();
        broadcast("data:updated", { table: "projects", id: projectId, action: "reparented" });
        return Response.json(project, { headers });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers });
  },
});

function buildAgentPrompt(agent: string, params: any): string {
  switch (agent) {
    case "impact-analyzer":
      return `You are an impact analyzer for a project management system. Analyze the impact of changing decision #${params.decision_id} in project #${params.project_id}.

Database is at: ${DB_PATH}
Query the PMM database using bun:sqlite to find:
1. What milestones reference this decision?
2. What tasks depend on the affected area?
3. What dependencies would break?
4. What success criteria might be invalidated?

Return a JSON object with:
{
  "impacts": [{ "table": "milestones|tasks|features", "id": number, "type": "blocks|invalidates|requires-change" }],
  "alerts": [{ "severity": "info|warning|critical", "message": "string" }],
  "summary": "brief analysis"
}`;

    case "health-scorer":
      return `You are a project health scorer. Read the PMM database at ${DB_PATH}. For each active project, score its health based on:
- Last session date (stale if > 7 days)
- Open roadblocks
- Overdue milestones
- Stuck tasks

Return: { "scores": { "1": "healthy", "2": "attention", ... } }`;

    case "pattern-detector":
      return `You are a pattern detector. Read the PMM database at ${DB_PATH}. Find cross-project patterns:
- Same roadblock appearing in multiple projects
- Same tech choices made in 3+ projects
- Sessions clustering patterns (which projects get most time?)

Return: { "patterns": [{ "name": "...", "description": "...", "category": "tech-choice|pitfall|workflow|architecture", "confidence": 0.8 }] }`;

    default:
      return `Process this request: ${JSON.stringify(params)}`;
  }
}

console.log(`🧠 PMM Bridge running → http://localhost:${PORT}`);
console.log(`   GET  /api/pmm/projects`);
console.log(`   GET  /api/pmm/projects/:id`);
console.log(`   GET  /api/pmm/notes`);
console.log(`   POST /api/pmm/notes`);
console.log(`   POST /api/pmm/update`);
console.log(`   POST /api/pmm/agent`);
console.log(`   GET  /api/pmm/stream (SSE)`);
console.log(`   GET  /api/pmm/workers`);
console.log(`   GET  /api/pmm/drift`);
console.log(`   GET  /api/pmm/config`);
