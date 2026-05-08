/**
 * Cross-Project Dependency Graph — Linker for PMM-AI
 * ===================================================
 * Resolves project-to-project dependencies, detects circular deps,
 * surfaces orphaned references, and maps the full integration graph.
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne } from "../db";

export interface DepGraph {
  nodes: { id: number; name: string; phase: string; health: string; edges_in: number; edges_out: number }[];
  edges: { from: string; to: string; description: string | null }[];
  circular_deps: string[][];
  orphans: { name: string; reason: string }[];
  most_depended_on: { name: string; count: number }[];
}

export function build(db: Database): DepGraph {
  const graph: DepGraph = {
    nodes: [],
    edges: [],
    circular_deps: [],
    orphans: [],
    most_depended_on: [],
  };

  // Load edges from dependencies table (project → project)
  const deps = queryAll(db, `
    SELECT p1.name as from_project, p2.name as to_project, d.description
    FROM dependencies d
    JOIN projects p1 ON d.from_project_id = p1.id
    JOIN projects p2 ON d.to_project_id = p2.id
  `) as any[];

  // Also capture integration_edges (tool-to-tool) as project-level hints
  const toolEdges = queryAll(db, `
    SELECT p.name as project_name, ie.from_tool, ie.to_tool, ie.description
    FROM integration_edges ie
    JOIN projects p ON ie.project_id = p.id
  `) as any[];

  // Add dependency edges
  for (const d of deps) {
    graph.edges.push({
      from: d.from_project,
      to: d.to_project,
      description: d.description ?? null,
    });
  }

  // Add tool edges as project self-edges (informational)
  for (const e of toolEdges) {
    graph.edges.push({
      from: e.project_name,
      to: e.project_name,
      description: `${e.from_tool} → ${e.to_tool}` + (e.description ? `: ${e.description}` : ""),
    });
  }

  // Build adjacency
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)!.add(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    if (!inDegree.has(e.from)) inDegree.set(e.from, 0);
  }

  // Nodes
  const projects = queryAll(db,
    "SELECT id, name, phase, health FROM projects WHERE status = 'active' ORDER BY name",
  ) as any[];

  for (const p of projects) {
    graph.nodes.push({
      id: p.id,
      name: p.name,
      phase: p.phase,
      health: p.health,
      edges_out: adj.get(p.name)?.size ?? 0,
      edges_in: inDegree.get(p.name) ?? 0,
    });
  }

  // Orphans: projects with 0 edges either direction
  graph.orphans = graph.nodes
    .filter(n => n.edges_in === 0 && n.edges_out === 0)
    .map(n => ({ name: n.name, reason: "No dependency edges — may be standalone or unintegrated" }));

  // Most depended on
  graph.most_depended_on = [...inDegree.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Circular deps detection (simple DFS)
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]) {
    visited.add(node);
    recStack.add(node);
    path.push(node);
    const neighbors = adj.get(node);
    if (neighbors) {
      for (const next of neighbors) {
        if (!visited.has(next)) {
          dfs(next, [...path]);
        } else if (recStack.has(next)) {
          const cycleStart = path.indexOf(next);
          if (cycleStart >= 0) {
            cycles.push(path.slice(cycleStart));
          }
        }
      }
    }
    recStack.delete(node);
  }

  for (const p of projects) {
    if (!visited.has(p.name)) dfs(p.name, []);
  }

  graph.circular_deps = cycles;

  return graph;
}
