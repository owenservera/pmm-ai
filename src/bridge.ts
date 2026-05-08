import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ProjectRow {
  id: number;
  name: string;
  status: string;
  phase: string;
  priority: string;
  repo_path: string;
  tech_stack: string;
  health: string;
}

const DB_PATH = join(import.meta.dir, "..", "..", "PMM", "pmm.db");

export function openDB(): Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

export function listProjects(): ProjectRow[] {
  const db = openDB();
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT * FROM projects ORDER BY
         CASE priority
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END, name`,
      )
      .all() as ProjectRow[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function getProject(name: string): ProjectRow | null {
  const db = openDB();
  if (!db) return null;
  try {
    return db.query("SELECT * FROM projects WHERE name = ?").get(name) as ProjectRow | null;
  } finally {
    db.close();
  }
}

export function getAlerts(): any[] {
  const db = openDB();
  if (!db) return [];
  try {
    return db
      .query("SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY created_at DESC")
      .all();
  } finally {
    db.close();
  }
}

export function getUpcomingMilestones(limit = 5): any[] {
  const db = openDB();
  if (!db) return [];
  try {
    return db
      .query(
        "SELECT m.*, p.name as project_name FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.status != 'done' ORDER BY m.due ASC LIMIT ?",
      )
      .all(limit);
  } finally {
    db.close();
  }
}
