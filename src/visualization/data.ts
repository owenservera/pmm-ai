/**
 * PMM Visualization — Database Query Helpers
 * ============================================
 * Structured queries for visualization data. Each function returns
 * data shaped for direct consumption by chart generators.
 */
import type { Database } from "bun:sqlite";
import { DB_PATH } from "../db";

export interface ProjectSummary {
  id: number;
  name: string;
  phase: string;
  priority: string;
  health: string;
  status: string;
  repo_path: string | null;
  node_id: number | null;
  milestone_count: number;
  task_count: number;
  open_roadblocks: number;
  feature_count: number;
  completed_tasks: number;
  last_session: string | null;
  last_active_days: number | null;
}

export interface MilestoneData {
  id: number;
  name: string;
  due: string | null;
  status: string;
  acceptance_criteria: string | null;
  task_total: number;
  task_done: number;
  node_id?: number | null;
}

export interface FeatureData {
  id: number;
  name: string;
  status: string;
  priority: string;
  description: string | null;
  epic_milestone_id: number | null;
  milestone_name: string | null;
  task_count: number;
  task_done: number;
}

export interface TaskData {
  id: number;
  name: string;
  status: string;
  milestone_id: number | null;
  milestone_name: string | null;
  session_id: number | null;
  methods: string | null;
  evidence: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface RoadblockData {
  id: number;
  description: string;
  severity: string;
  milestone_id: number | null;
  milestone_name: string | null;
  resolution: string | null;
  created_at: string;
}

export interface WorkerData {
  id: number;
  agent_type: string;
  model: string;
  status: string;
  task_description: string;
  project_name: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PortfolioNodeData {
  id: number;
  parent_id: number | null;
  type: string;
  name: string;
  status: string;
  sort_order: number;
  target_date: string | null;
  description: string | null;
  project_count: number;
  children?: PortfolioNodeData[];
  projects?: ProjectSummary[];
}

export interface SessionData {
  id: number;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

export interface ProjectDashboardData {
  project: ProjectSummary;
  milestones: MilestoneData[];
  features: FeatureData[];
  tasks: TaskData[];
  roadblocks: RoadblockData[];
  workers: WorkerData[];
  sessions: SessionData[];
}

export interface PortfolioDashboardData {
  projects: ProjectSummary[];
  nodes: PortfolioNodeData[];
  tree: PortfolioNodeData[];
  unlinked: ProjectSummary[];
  workers: WorkerData[];
  timestamp: string;
}

/** Open the PMM database read-only */
export function openVisualizationDB(): Database {
  const { Database } = require("bun:sqlite");
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

/** Fetch complete data for a single project dashboard */
export function fetchProjectData(db: Database, projectId: number): ProjectDashboardData | null {
  const project = db
    .query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM milestones WHERE project_id = p.id) as milestone_count,
        (SELECT COUNT(*) FROM atomic_tasks WHERE project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM atomic_tasks WHERE project_id = p.id AND status = 'done') as completed_tasks,
        (SELECT COUNT(*) FROM roadblocks WHERE project_id = p.id AND resolved_at IS NULL) as open_roadblocks,
        (SELECT COUNT(*) FROM features WHERE project_id = p.id) as feature_count,
        (SELECT MAX(started_at) FROM sessions WHERE project_id = p.id) as last_session
       FROM projects p WHERE p.id = ?`,
    )
    .get(projectId) as any;

  if (!project) return null;

  const lastSession = project.last_session;
  const lastActiveDays = lastSession
    ? Math.floor((Date.now() - new Date(lastSession + "Z").getTime()) / 86400000)
    : null;

  const projectSummary: ProjectSummary = {
    ...project,
    tech_stack: undefined,
    updated_at: undefined,
    created_at: undefined,
    last_active_days: lastActiveDays,
  };

  const milestones = db
    .query(
      `SELECT m.*,
        (SELECT COUNT(*) FROM atomic_tasks WHERE milestone_id = m.id) as task_total,
        (SELECT COUNT(*) FROM atomic_tasks WHERE milestone_id = m.id AND status = 'done') as task_done
       FROM milestones m WHERE m.project_id = ? ORDER BY m.due`,
    )
    .all(projectId) as MilestoneData[];

  const features = db
    .query(
      `SELECT f.*,
        m.name as milestone_name,
        (SELECT COUNT(*) FROM atomic_tasks WHERE id IN (
          SELECT id FROM atomic_tasks LIMIT 0
        )) as task_count,
        0 as task_done
       FROM features f
       LEFT JOIN milestones m ON f.epic_milestone_id = m.id
       WHERE f.project_id = ?
       ORDER BY f.priority, f.status`,
    )
    .all(projectId) as FeatureData[];

  const tasks = db
    .query(
      `SELECT t.*, m.name as milestone_name
       FROM atomic_tasks t
       LEFT JOIN milestones m ON t.milestone_id = m.id
       WHERE t.project_id = ?
       ORDER BY t.status, t.created_at`,
    )
    .all(projectId) as TaskData[];

  const roadblocks = db
    .query(
      `SELECT r.*, m.name as milestone_name
       FROM roadblocks r
       LEFT JOIN milestones m ON r.milestone_id = m.id
       WHERE r.project_id = ? AND r.resolved_at IS NULL
       ORDER BY r.severity`,
    )
    .all(projectId) as RoadblockData[];

  const workers = db
    .query(
      `SELECT w.*, p.name as project_name
       FROM agent_workers w
       LEFT JOIN projects p ON w.project_id = p.id
       WHERE w.project_id = ?
       ORDER BY w.started_at DESC LIMIT 30`,
    )
    .all(projectId) as WorkerData[];

  const sessions = db
    .query(
      "SELECT id, started_at, ended_at, summary FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 20",
    )
    .all(projectId) as SessionData[];

  return { project: projectSummary, milestones, features, tasks, roadblocks, workers, sessions };
}

/** Fetch portfolio-level data for the portfolio dashboard */
export function fetchPortfolioData(db: Database): PortfolioDashboardData {
  const projects = db
    .query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM milestones WHERE project_id = p.id) as milestone_count,
        (SELECT COUNT(*) FROM atomic_tasks WHERE project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM atomic_tasks WHERE project_id = p.id AND status = 'done') as completed_tasks,
        (SELECT COUNT(*) FROM roadblocks WHERE project_id = p.id AND resolved_at IS NULL) as open_roadblocks,
        (SELECT COUNT(*) FROM features WHERE project_id = p.id) as feature_count,
        (SELECT MAX(started_at) FROM sessions WHERE project_id = p.id) as last_session
       FROM projects p
       WHERE p.status = 'active'
       ORDER BY
         CASE p.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
         p.name`,
    )
    .all() as any[];

  const projectSummaries: ProjectSummary[] = projects.map((p: any) => {
    const lastSession = p.last_session;
    const lastActiveDays = lastSession
      ? Math.floor((Date.now() - new Date(lastSession + "Z").getTime()) / 86400000)
      : null;
    return {
      ...p,
      tech_stack: undefined,
      updated_at: undefined,
      created_at: undefined,
      last_active_days: lastActiveDays,
    };
  });

  const allNodes = db
    .query("SELECT * FROM portfolio_nodes ORDER BY parent_id, sort_order, name")
    .all() as any[];

  // Build node tree
  const nodeMap = new Map<number, PortfolioNodeData>();
  const roots: PortfolioNodeData[] = [];
  const childrenByParent = new Map<number, PortfolioNodeData[]>();

  // First pass: create node objects
  for (const n of allNodes) {
    const node: PortfolioNodeData = {
      id: n.id,
      parent_id: n.parent_id,
      type: n.type,
      name: n.name,
      status: n.status,
      sort_order: n.sort_order,
      target_date: n.target_date,
      description: n.description,
      project_count: 0,
    };
    nodeMap.set(n.id, node);
  }

  // Second pass: build hierarchy and count projects
  for (const p of projects) {
    if (p.node_id && nodeMap.has(p.node_id)) {
      const node = nodeMap.get(p.node_id)!;
      if (!node.projects) node.projects = [];
      node.projects.push({
        id: p.id,
        name: p.name,
        phase: p.phase,
        priority: p.priority,
        health: p.health,
        status: p.status,
        repo_path: p.repo_path,
        node_id: p.node_id,
        milestone_count: p.milestone_count,
        task_count: p.task_count,
        open_roadblocks: p.open_roadblocks,
        feature_count: p.feature_count,
        completed_tasks: p.completed_tasks,
        last_session: p.last_session,
        last_active_days: projectSummaries.find((ps: any) => ps.id === p.id)?.last_active_days ?? null,
      });
    }
  }

  for (const n of allNodes) {
    const node = nodeMap.get(n.id)!;
    if (n.parent_id && nodeMap.has(n.parent_id)) {
      if (!childrenByParent.has(n.parent_id)) childrenByParent.set(n.parent_id, []);
      childrenByParent.get(n.parent_id)!.push(node);
    } else if (!n.parent_id) {
      roots.push(node);
    }
  }

  function buildTree(node: PortfolioNodeData): PortfolioNodeData {
    const children = childrenByParent.get(node.id) || [];
    const built = children.map(buildTree);
    const projCount =
      (node.projects?.length || 0) +
      built.reduce((sum, c) => sum + c.project_count, 0);
    return { ...node, children: built, project_count: projCount };
  }

  const tree = roots.map(buildTree);
  const unlinked = projectSummaries.filter((p) => !p.node_id);

  const workers = db
    .query(
      `SELECT w.*, p.name as project_name
       FROM agent_workers w
       LEFT JOIN projects p ON w.project_id = p.id
       ORDER BY w.started_at DESC LIMIT 30`,
    )
    .all() as WorkerData[];

  return {
    projects: projectSummaries,
    nodes: Array.from(nodeMap.values()),
    tree,
    unlinked,
    workers,
    timestamp: new Date().toISOString(),
  };
}
