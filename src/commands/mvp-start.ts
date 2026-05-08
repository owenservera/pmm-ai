/**
 * PMM-AI Start Command — "pmm start"
 * ===================================
 * The ONE command vibe coders need to know.
 *
 * Usage:
 *   pmm start              → Launch live dashboard
 *   pmm start new          → Create a new project (wizard)
 *   pmm start <project>    → View project dashboard
 */
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { queryAll, queryOne, run } from "../db";
import { badge, divider, healthIcon } from "../commands/shared";
import { mvpNewProject } from "./mvp-wizard";

const ROOT = join(import.meta.dir, "..", "..", "..");

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // pmm start — the ONE command
  start: async (db, args) => {
    const sub = args[0];

    // pmm start new → wizard
    if (sub === "new") {
      await mvpNewProject(db);
      return;
    }

    // pmm start <project> → view project dashboard
    if (sub) {
      await openProjectDashboard(db, sub);
      return;
    }

    // pmm start (no args) → launch live dashboard + show portfolio
    await showPortfolio(db);
    launchLiveDashboard();
  },

  // pmm new — alias for start new
  new: async (db, _args) => {
    await mvpNewProject(db);
  },
};

// ─── Portfolio Display ─────────────────────────────────────────────────

async function showPortfolio(db: Database): Promise<void> {
  console.log("");
  console.log("  " + badge("◆ PMM-AI", "blue") + "  — Autonomous Development Platform");
  console.log("  " + "─".repeat(52));

  const projects = queryAll(db,
    "SELECT name, phase, priority, health FROM projects WHERE status = 'active' ORDER BY priority, name",
  ) as any[];

  if (projects.length === 0) {
    console.log("");
    console.log("  No projects yet! Create your first:");
    console.log("    bun PMM-AI/scripts/cli.ts start new");
    console.log("");
    return;
  }

  console.log("");
  console.log("  " + badge("PORTFOLIO", "blue") + "  (" + projects.length + " projects)");
  console.log("  " + "─".repeat(52));

  for (const p of projects) {
    const icon = healthIcon(p.health);
    const pBadge = p.priority === "critical" ? badge("CRIT", "red")
      : p.priority === "high" ? badge("HIGH", "yellow")
      : badge(p.priority.toUpperCase(), "dim");
    console.log("  " + icon + " " + badge(p.name, "blue") + "  " + pBadge + "  " + badge(p.phase, "dim"));
  }

  // Active sessions
  const activeSessions = queryAll(db,
    "SELECT s.id, p.name as project, s.started_at FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 5",
  ) as any[];
  if (activeSessions.length > 0) {
    console.log("");
    console.log("  " + badge("ACTIVE", "green") + "  " + activeSessions.length + " session" + (activeSessions.length > 1 ? "s" : ""));
    for (const s of activeSessions) {
      console.log("    → " + s.project + " (since " + (s.started_at ?? "?").toString().slice(0, 16) + ")");
    }
  }

  console.log("");
  console.log("  " + badge("QUICK ACTIONS", "dim"));
  console.log("  " + "─".repeat(52));
  console.log("  " + badge("new", "green") + "        pmm start new          Create a project");
  console.log("  " + badge("view", "green") + "       pmm start <project>    Open dashboard");
  console.log("  " + badge("live", "green") + "       → http://localhost:9998  Auto-refreshing");
  console.log("");
}

// ─── Project Dashboard ─────────────────────────────────────────────────

async function openProjectDashboard(db: Database, projectName: string): Promise<void> {
  const project = queryOne(db, "SELECT id, name, phase, priority, health FROM projects WHERE name = ?", [projectName]) as any;

  if (!project) {
    console.log("");
    console.log("  " + badge("Not found", "yellow") + " Project \"" + projectName + "\" is not registered.");
    console.log("  Create it: bun PMM-AI/scripts/cli.ts start new");
    console.log("");
    return;
  }

  // Collect project stats
  const msCount = (queryOne(db, "SELECT COUNT(*) as c FROM milestones WHERE project_id = ?", [project.id]) as any)?.c ?? 0;
  const feCount = (queryOne(db, "SELECT COUNT(*) as c FROM features WHERE project_id = ?", [project.id]) as any)?.c ?? 0;
  const taskCount = (queryOne(db, "SELECT COUNT(*) as c FROM atomic_tasks WHERE project_id = ?", [project.id]) as any)?.c ?? 0;
  const openDecisions = (queryOne(db, "SELECT COUNT(*) as c FROM decisions WHERE project_id = ? AND status = 'open'", [project.id]) as any)?.c ?? 0;
  const roadblocks = (queryOne(db, "SELECT COUNT(*) as c FROM roadblocks WHERE project_id = ? AND resolved_at IS NULL", [project.id]) as any)?.c ?? 0;
  const swarmTasks = (queryOne(db, "SELECT COUNT(*) as c FROM swarm_tasks WHERE project_id = ? AND status = 'completed'", [project.id]) as any)?.c ?? 0;
  const totalSwarm = (queryOne(db, "SELECT COUNT(*) as c FROM swarm_tasks WHERE project_id = ?", [project.id]) as any)?.c ?? 0;
  const recentWorkers = queryAll(db,
    "SELECT agent_type, model, status FROM agent_workers WHERE project_id = ? ORDER BY created_at DESC LIMIT 5",
    [project.id],
  ) as any[];

  const icon = healthIcon(project.health);
  console.log("");
  console.log("  " + icon + " " + badge(project.name, "blue") + "  " + badge(project.phase, "dim") + "  " + badge(project.priority.toUpperCase(), project.priority === "critical" ? "red" : "yellow"));
  console.log("  " + "─".repeat(52));
  console.log("");
  console.log("  Plan:     " + msCount + " milestones | " + feCount + " features | " + taskCount + " tasks");
  if (openDecisions > 0) console.log("  " + badge("○ " + openDecisions + " open decisions", "yellow"));
  if (roadblocks > 0) console.log("  " + badge("✗ " + roadblocks + " roadblocks", "red"));
  if (totalSwarm > 0) console.log("  Swarm:    " + swarmCountBar(swarmTasks, totalSwarm));
  console.log("");

  console.log("  " + badge("Recent Activity", "dim"));
  for (const w of recentWorkers) {
    const sIcon = w.status === "completed" ? "✓" : w.status === "dispatched" ? "→" : "○";
    console.log("  " + sIcon + " " + w.agent_type + " (" + w.model + ") — " + w.status);
  }
  console.log("");

  console.log("  " + badge("Actions", "dim"));
  console.log("  View dashboard:  bun PMM-AI/scripts/cli.ts view " + projectName);
  console.log("  Deploy swarm:    bun PMM-AI/scripts/cli.ts swarm deploy " + projectName);
  console.log("  Check health:    bun PMM-AI/scripts/cli.ts health");
  console.log("");

  // Try to generate and open dashboard
  try {
    const { generateProjectDashboard } = await import("../visualization/generator");
    const { fetchProjectData, openVisualizationDB } = await import("../visualization/data");
    const vizDb = openVisualizationDB();
    const data = fetchProjectData(vizDb, project.id);
    vizDb.close();

    if (data) {
      const html = generateProjectDashboard(data, "all");
      const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const outPath = join(ROOT, "PMM", safeName, "dashboard.html");
      const dir = join(ROOT, "PMM", safeName);
      if (!existsSync(dir)) { try { require("fs").mkdirSync(dir, { recursive: true }); } catch {} }
      require("fs").writeFileSync(outPath, html, "utf-8");

      const isWin = process.platform === "win32";
      const launchCmd = isWin ? "cmd" : (process.platform === "darwin" ? "open" : "xdg-open");
      const launchArgs = isWin ? ["/c", "start", "", outPath] : [outPath];
      spawn(launchCmd, launchArgs, { detached: true, stdio: "ignore" });
      console.log("  " + badge("✓", "green") + " Dashboard opened in browser.");
      console.log("");
    }
  } catch {
    // Non-critical — visualization might not be available
  }
}

function swarmCountBar(completed: number, total: number): string {
  const pct = total > 0 ? Math.round((completed / total) * 10) : 0;
  return "[" + "█".repeat(pct) + "░".repeat(10 - pct) + "] " + completed + "/" + total;
}

// ─── Live Dashboard Launcher ───────────────────────────────────────────

function launchLiveDashboard(): void {
  const url = "http://localhost:9998";

  try {
    // Try to start the live server in background
    const serverPath = join(ROOT, "PMM-AI", "src", "visualization", "server.ts");
    if (existsSync(serverPath)) {
      const proc = spawn("bun", ["run", serverPath, "--port", "9998"], {
        detached: true,
        stdio: "ignore",
        cwd: ROOT,
      });
      proc.unref();
    }

    // Open browser
    const isWin = process.platform === "win32";
    const launchCmd = isWin ? "cmd" : (process.platform === "darwin" ? "open" : "xdg-open");
    const launchArgs = isWin ? ["/c", "start", "", url] : [url];
    spawn(launchCmd, launchArgs, { detached: true, stdio: "ignore" });

    console.log("");
    console.log("  " + badge("✦", "green") + " Live dashboard: " + url);
    console.log("  " + badge("  ", "dim") + "  Auto-refreshes every 5 seconds.");
    console.log("");
  } catch {
    console.log("  Open: " + url);
  }
}
