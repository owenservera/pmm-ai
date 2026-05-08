/**
 * PMM-AI Status Command — "Where am I?"
 * ======================================
 * Human-readable project narrative: phase, progress, recent activity,
 * open blockers, next-action inference. One glance to resume context.
 *
 * Usage:
 *   pmm-ai status <project>      Project narrative
 *   pmm-ai status                Context-aware (current project or portfolio)
 *   pmm-ai resume                Resume last session
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne, getProjectId, getProjectIdOrFail } from "../db";
import { badge, divider, healthIcon } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "status": async (db, args) => {
    const projectName = args[0];
    if (!projectName) {
      // No project specified — show portfolio overview
      await portfolioStatus(db);
      return;
    }
    await projectStatus(db, projectName);
  },

  "resume": async (db, args) => {
    const projectName = args[0];
    if (!projectName) {
      // Look up last active project from sessions
      const last = queryOne(db,
        "SELECT p.name FROM sessions s JOIN projects p ON s.project_id=p.id ORDER BY s.started_at DESC LIMIT 1"
      ) as any;
      if (last) {
        await projectStatus(db, last.name);
      } else {
        console.log("");
        console.log("  No previous sessions found.");
        console.log("  Run " + badge("pmm-ai start", "green") + " to see your portfolio.");
        console.log("");
      }
      return;
    }
    await projectStatus(db, projectName);
  },
};

// ─── Portfolio Overview ────────────────────────────────────────────────

async function portfolioStatus(db: Database) {
  const projects = queryAll(db,
    "SELECT name, phase, priority, health FROM projects WHERE status='active' ORDER BY priority, name"
  ) as any[];
  const stale = queryAll(db,
    "SELECT name, health, last_session FROM projects WHERE status='active' AND (last_session IS NULL OR last_session < datetime('now','-14 days'))"
  ) as any[];
  const blocked = queryAll(db,
    "SELECT p.name, r.description FROM roadblocks r JOIN projects p ON r.project_id=p.id WHERE r.resolved_at IS NULL ORDER BY r.severity"
  ) as any[];
  const activeSessions = queryAll(db,
    "SELECT p.name, s.started_at FROM sessions s JOIN projects p ON s.project_id=p.id WHERE s.ended_at IS NULL"
  ) as any[];

  console.log("");
  console.log("  " + badge("◆ PMM-AI Status", "blue") + "  " + new Date().toLocaleDateString());
  divider("", 52);

  // Active sessions
  if (activeSessions.length > 0) {
    console.log("");
    console.log("  " + badge(activeSessions.length + " active", "green"));
    for (const s of activeSessions) {
      console.log("    → " + s.name + " (since " + (s.started_at ?? "?").toString().slice(0, 16) + ")");
    }
  }

  // Projects needing attention
  const attentionProjects = projects.filter((p: any) => p.health !== "healthy" || stale.some((s: any) => s.name === p.name));
  if (attentionProjects.length > 0) {
    console.log("");
    console.log("  " + badge("Needs Attention", "yellow"));
    for (const p of attentionProjects) {
      const icon = healthIcon(p.health);
      console.log("    " + icon + " " + p.name + "  " + badge(p.phase, "dim"));
    }
  }

  // Blockers
  if (blocked.length > 0) {
    console.log("");
    console.log("  " + badge(blocked.length + " blockers", "red"));
    for (const b of blocked.slice(0, 5)) {
      console.log("    ✗ " + b.name + ": " + (b.description || "").slice(0, 60));
    }
  }

  // Summary
  const critical = projects.filter((p: any) => p.priority === "critical" && p.health === "healthy").length;
  const inBuild = projects.filter((p: any) => p.phase === "build").length;
  console.log("");
  console.log("  " + projects.length + " projects  |  " + inBuild + " building  |  " + critical + " critical healthy");
  console.log("  Run: " + badge("pmm-ai status <project>", "green") + " for detail");
  console.log("");
}

// ─── Project Status ─────────────────────────────────────────────────────

async function projectStatus(db: Database, projectName: string) {
  const project = queryOne(db,
    "SELECT id, name, phase, priority, health, tech_stack FROM projects WHERE name=?", [projectName]
  ) as any;

  if (!project) {
    console.log("");
    console.log("  " + badge("Not found", "yellow") + " Project \"" + projectName + "\" is not registered.");
    console.log("  Register: " + badge("pmm-ai project register " + projectName, "green"));
    console.log("");
    return;
  }

  // Collect all stats
  const msCount = count(db, "milestones", project.id);
  const msDone = count(db, "milestones", project.id, "status='completed'");
  const feCount = count(db, "features", project.id);
  const feDone = count(db, "features", project.id, "status='done'");
  const taskCount = count(db, "atomic_tasks", project.id);
  const taskDone = count(db, "atomic_tasks", project.id, "status='done'");
  const openDecisions = count(db, "decisions", project.id, "status='open'");
  const activeRoadblocks = queryAll(db,
    "SELECT description, severity FROM roadblocks WHERE project_id=? AND resolved_at IS NULL ORDER BY severity", [project.id]
  ) as any[];
  const lastSession = queryOne(db,
    "SELECT started_at, ended_at, summary FROM sessions WHERE project_id=? ORDER BY started_at DESC LIMIT 1", [project.id]
  ) as any;
  const recentWorkers = queryAll(db,
    "SELECT agent_type, model, status, task_description FROM agent_workers WHERE project_id=? ORDER BY created_at DESC LIMIT 5", [project.id]
  ) as any[];
  const swarmTasks = queryAll(db,
    "SELECT layer_num, routing_code, name, status FROM swarm_tasks WHERE project_id=? ORDER BY layer_num, routing_code", [project.id]
  ) as any[];

  // Calculate overall progress
  const totalItems = msCount + feCount + taskCount;
  const doneItems = msDone + feDone + taskDone;
  const progressPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  const icon = healthIcon(project.health);
  const phaseColors: Record<string, string> = { discover: "dim", define: "blue", design: "yellow", build: "green", ship: "green", maintain: "blue" };
  const phaseColor = phaseColors[project.phase] || "dim";

  console.log("");
  console.log("  " + icon + " " + badge(project.name, "blue") + "  " + badge(project.phase, phaseColor) + "  " + badge(project.priority.toUpperCase(), project.priority === "critical" ? "red" : "yellow"));
  divider("", 52);
  console.log("");

  // Progress bar
  if (totalItems > 0) {
    const barLen = 20;
    const filled = Math.round((progressPct / 100) * barLen);
    const bar = "\x1b[32m" + "█".repeat(filled) + "\x1b[0m" + "░".repeat(barLen - filled);
    console.log("  " + badge("Progress", "blue") + "  " + bar + "  " + progressPct + "%");
    console.log("          " + msDone + "/" + msCount + " milestones  |  " + feDone + "/" + feCount + " features  |  " + taskDone + "/" + taskCount + " tasks");
  } else {
    console.log("  " + badge("Progress", "dim") + "  No milestones, features, or tasks yet.");
    console.log("          Start: " + badge("pmm-ai plan " + projectName, "green"));
  }

  // Stack
  if (project.tech_stack) {
    console.log("  " + badge("Stack", "dim") + "    " + project.tech_stack);
  }
  console.log("");

  // Last session
  if (lastSession) {
    const started = (lastSession.started_at ?? "").toString().slice(0, 16);
    const ended = lastSession.ended_at ? (lastSession.ended_at ?? "").toString().slice(0, 16) : "active";
    console.log("  " + badge("Last Session", "blue"));
    console.log("  " + started + " → " + ended);
    if (lastSession.summary) {
      console.log("  \x1b[2m" + lastSession.summary.slice(0, 80) + "\x1b[0m");
    }
    console.log("");
  }

  // Swarm state
  if (swarmTasks.length > 0) {
    const swarmDone = swarmTasks.filter((t: any) => t.status === "completed").length;
    const swarmPct = Math.round((swarmDone / swarmTasks.length) * 100);
    const sFilled = Math.round((swarmPct / 100) * 10);
    const sBar = "█".repeat(sFilled) + "░".repeat(10 - sFilled);
    console.log("  " + badge("Swarm", "blue") + "    [" + sBar + "] " + swarmDone + "/" + swarmTasks.length + "  (" + swarmPct + "%)");

    // Group by layer
    let currentLayer = -1;
    for (const t of swarmTasks) {
      if (t.layer_num !== currentLayer) {
        currentLayer = t.layer_num;
        const layerTasks = swarmTasks.filter((x: any) => x.layer_num === currentLayer);
        const lDone = layerTasks.filter((x: any) => x.status === "completed").length;
        console.log("          L" + currentLayer + ": " + lDone + "/" + layerTasks.length + " done");
      }
    }
    console.log("");
  }

  // Recent activity
  if (recentWorkers.length > 0) {
    console.log("  " + badge("Recent Activity", "blue"));
    for (const w of recentWorkers.slice(0, 3)) {
      const sIcon = w.status === "completed" ? "✓" : w.status === "dispatched" ? "→" : w.status === "running" ? "●" : "○";
      const desc = w.task_description ? w.task_description.slice(0, 50) : "";
      console.log("  " + sIcon + " " + w.agent_type + " (" + w.model + ") " + badge(w.status, "dim") + "  " + desc);
    }
    console.log("");
  }

  // Roadblocks
  if (activeRoadblocks.length > 0) {
    console.log("  " + badge("Roadblocks", "red") + "  " + activeRoadblocks.length + " active");
    for (const r of activeRoadblocks) {
      const sevIcon = r.severity === "critical" ? "✗" : r.severity === "high" ? "⚠" : "○";
      console.log("  " + sevIcon + " [" + r.severity + "] " + (r.description || "").slice(0, 70));
    }
    console.log("");
  }

  // Open decisions
  if (openDecisions > 0) {
    console.log("  " + badge("Open Decisions", "yellow") + "  " + openDecisions + " awaiting resolution");
    console.log("");
  }

  // Next Action Inference
  const nextAction = inferNextAction(db, project, msCount, msDone, feCount, feDone, taskCount, taskDone, activeRoadblocks, swarmTasks, openDecisions);
  console.log("  " + badge("Next Action", "green"));
  console.log("  → " + nextAction);
  console.log("");

  // Quick commands
  console.log("  " + badge("Quick Resume", "dim"));
  console.log("  " + badge("plan", "green") + "  pmm-ai plan " + projectName);
  console.log("  " + badge("build", "green") + " pmm-ai swarm deploy " + projectName);
  console.log("  " + badge("view", "green") + "  pmm-ai view " + projectName);
  console.log("");
}

// ─── Next Action Inference ─────────────────────────────────────────────

function inferNextAction(
  db: Database,
  project: any,
  msCount: number,
  msDone: number,
  feCount: number,
  feDone: number,
  taskCount: number,
  taskDone: number,
  roadblocks: any[],
  swarmTasks: any[],
  openDecisions: number,
): string {
  // Priority: roadblocks > stale decisions > unfinished tasks > no plan

  if (roadblocks.length > 0) {
    const critical = roadblocks.filter((r: any) => r.severity === "critical");
    if (critical.length > 0) {
      return "Resolve " + critical.length + " critical blocker" + (critical.length > 1 ? "s" : "") + " before continuing.";
    }
    return "Address " + roadblocks.length + " open blocker" + (roadblocks.length > 1 ? "s" : "") + " — " + roadblocks[0].description.slice(0, 40);
  }

  if (openDecisions > 3) {
    return "Resolve " + openDecisions + " open architectural decisions — blocking downstream work.";
  }

  if (taskCount > 0 && taskDone < taskCount) {
    const pending = queryAll(db,
      "SELECT name FROM atomic_tasks WHERE project_id=? AND status='pending' ORDER BY created_at LIMIT 1", [project.id]
    ) as any[];
    if (pending.length > 0) {
      return "Pick up next task: \"" + pending[0].name + "\"";
    }
    const inProgress = queryAll(db,
      "SELECT name FROM atomic_tasks WHERE project_id=? AND status='in-progress' ORDER BY created_at LIMIT 1", [project.id]
    ) as any[];
    if (inProgress.length > 0) {
      return "Continue: \"" + inProgress[0].name + "\" (" + inProgress.length + " in progress)";
    }
  }

  if (msCount === 0 && feCount === 0) {
    return "No plan yet — generate one: pmm-ai plan " + project.name;
  }

  if (swarmTasks.length > 0) {
    const pendingSwarm = swarmTasks.filter((t: any) => t.status === "pending");
    if (pendingSwarm.length > 0) {
      return "Deploy swarm: " + pendingSwarm.length + " tasks ready across " + [...new Set(pendingSwarm.map((t: any) => t.layer_num))].length + " layers";
    }
  }

  if (project.phase === "discover") return "Discover phase — run pmm-ai wizard " + project.name + " to plan.";
  if (project.phase === "define") return "Define phase — create milestones and features.";
  if (project.phase === "design") return "Design phase — generate a detailed architecture plan.";
  if (project.phase === "build") return "Build phase — swarm deploy to continue implementation.";
  if (project.phase === "maintain") return "Maintain — run health check and review open issues.";

  return "Run pmm-ai plan " + project.name + " to continue.";
}

// ─── Helpers ────────────────────────────────────────────────────────────

function count(db: Database, table: string, projectId: number, extraWhere = ""): number {
  let sql = "SELECT COUNT(*) as c FROM " + table + " WHERE project_id=?";
  if (extraWhere) sql += " AND " + extraWhere;
  return (queryOne(db, sql, [projectId]) as any)?.c ?? 0;
}
