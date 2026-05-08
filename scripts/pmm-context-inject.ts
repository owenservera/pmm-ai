#!/usr/bin/env bun
/**
 * PMM Auto-Context Injection
 * ===========================
 * Generates an AI-ready context block from PMM DB state.
 * Wire into SessionStart hook for automatic project awareness.
 *
 * Output: structured markdown block to stdout
 * Exit 0: context generated successfully
 * Exit 1: PMM DB not available
 *
 * Usage:
 *   bun scripts/pmm-context-inject.ts [--project <name>] [--compact]
 */
import { openDb, queryAll, queryOne } from "../src/db";

const args = process.argv.slice(2);
let projectName: string | null = null;
let compact = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!;
  else if (args[i] === "--compact") compact = true;
}

const db = openDb();

try {
  // ── Auto-detect active project ────────────────────────
  if (!projectName) {
    // Check current session
    const session = queryOne(db,
      "SELECT p.name FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1"
    ) as any;
    if (session) projectName = session.name;

    // Check git branch → project mapping
    if (!projectName) {
      try {
        const proc = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: process.cwd() });
        const branch = proc.stdout.toString().trim();
        if (branch && branch !== "main" && branch !== "master") {
          // Try matching branch name to project
          const branchProjects = queryAll(db,
            "SELECT name FROM projects WHERE name LIKE ? OR name LIKE ?",
            [`%${branch.replace(/^feat\//, "").replace(/-/g, " ")}%`, `%${branch}%`]
          ) as any[];
          if (branchProjects.length === 1) projectName = branchProjects[0]!.name;
        }
      } catch {}
    }

    // Default
    if (!projectName) projectName = "TERMINAL";
  }

  const project = queryOne(db, "SELECT * FROM projects WHERE name = ?", [projectName]) as any;
  if (!project) {
    console.log(`<!-- PMM: Project "${projectName}" not registered -->`);
    process.exit(0);
  }

  // ── Gather context ─────────────────────────────────────
  const milestones = queryAll(db,
    "SELECT name, due, status, acceptance_criteria FROM milestones WHERE project_id = ? ORDER BY id", [project.id]
  ) as any[];
  const features = queryAll(db,
    "SELECT name, status, priority FROM features WHERE project_id = ? AND status != 'done' ORDER BY priority LIMIT 8", [project.id]
  ) as any[];
  const decisions = queryAll(db,
    "SELECT question, decision FROM decisions WHERE project_id = ? ORDER BY id DESC LIMIT 5", [project.id]
  ) as any[];
  const roadblocks = queryAll(db,
    "SELECT description, severity FROM roadblocks WHERE project_id = ? AND resolved_at IS NULL", [project.id]
  ) as any[];
  const recentWorkers = queryAll(db,
    "SELECT agent_type, status, result_summary FROM agent_workers WHERE project_id = ? ORDER BY created_at DESC LIMIT 5", [project.id]
  ) as any[];

  // Product/component context
  let componentName: string | null = null;
  let productName: string | null = null;
  if (project.node_id) {
    const component = queryOne(db,
      "SELECT name, parent_id FROM portfolio_nodes WHERE id = ? AND type = 'component'", [project.node_id]
    ) as any;
    if (component) {
      componentName = component.name;
      const product = queryOne(db, "SELECT name FROM portfolio_nodes WHERE id = ?", [component.parent_id]) as any;
      if (product) productName = product.name;
    }
  }

  // ── Build context block ────────────────────────────────
  if (compact) {
    // Compact mode: single line summary
    const msLine = milestones.map((m: any) => {
      const icon = m.status === "completed" ? "✓" : m.status === "in-progress" ? "▶" : "○";
      return `${icon}${m.name}`;
    }).join(" ");
    const warnings: string[] = [];
    if (roadblocks.length) warnings.push(`${roadblocks.length} roadblocks`);
    const healthWarning = project.health !== "healthy" ? `health:${project.health}` : "";
    if (healthWarning) warnings.push(healthWarning);

    console.log(`[PMM: ${project.name} | ${project.phase}/${project.priority} | ${msLine}${warnings.length ? " | ⚠ " + warnings.join(", ") : ""}]`);
  } else {
    // Full mode
    console.log("<!-- PMM AUTO-CONTEXT (generated at session start) -->");
    console.log("");
    console.log(`## Project: ${project.name}`);
    console.log(`**Phase:** ${project.phase} | **Priority:** ${project.priority} | **Health:** ${project.health}`);
    if (productName) console.log(`**Product:** ${productName}${componentName ? ` → ${componentName}` : ""}`);
    console.log(`**Stack:** ${JSON.parse(project.tech_stack || "[]").join(", ") || "unknown"}`);
    console.log("");

    if (milestones.length) {
      const done = milestones.filter((m: any) => m.status === "completed").length;
      const total = milestones.length;
      console.log(`### Milestones (${done}/${total})`);
      for (const m of milestones) {
        const icon = m.status === "completed" ? "✓" : m.status === "in-progress" ? "▶" : m.status === "blocked" ? "✗" : "○";
        console.log(`- ${icon} ${m.name}${m.due ? ` (${m.due})` : ""}`);
      }
      console.log("");
    }

    if (features.length) {
      console.log("### Active Features");
      for (const f of features) {
        console.log(`- ${f.name} [${f.priority}]`);
      }
      console.log("");
    }

    if (roadblocks.length) {
      console.log("### ⚠ Roadblocks");
      for (const r of roadblocks) {
        console.log(`- [${r.severity}] ${r.description}`);
      }
      console.log("");
    }

    if (decisions.length) {
      console.log("### Key Decisions");
      for (const d of decisions) {
        console.log(`- ${d.question.slice(0, 100)} → ${d.decision.slice(0, 100)}`);
      }
      console.log("");
    }

    if (recentWorkers.length) {
      console.log("### Recent Agent Activity");
      for (const w of recentWorkers) {
        console.log(`- ${w.agent_type} (${w.status})${w.result_summary ? ": " + w.result_summary.slice(0, 80) : ""}`);
      }
      console.log("");
    }

    // Next action suggestion
    const nextMilestone = milestones.find((m: any) => m.status !== "completed" && m.status !== "blocked");
    if (nextMilestone) {
      console.log("### Suggested Next");
      console.log(`Milestone: ${nextMilestone.name}`);
      if (nextMilestone.acceptance_criteria) {
        console.log(`Criteria: ${nextMilestone.acceptance_criteria.slice(0, 150)}`);
      }
    }
  }

  process.exit(0);
} finally {
  db.close();
}
