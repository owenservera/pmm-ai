/**
 * PMM-AI MVP Wizard — "pmm new"
 * ==============================
 * The single flow for creating a new project. No flags. No subcommands.
 * Just "pmm new" → answer one question → auto-plan → show dashboard.
 *
 * Complexity gates are enforced at each step. The engine room (swarm,
 * evaluator, workers) is auto-configured behind the scenes.
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getProjectIdOrFail, queryOne, run } from "../db";
import { badge, divider } from "../commands/shared";
import { derive, autoConfigureSwarm, checkGate } from "../auto-derive";
import type { ProjectProfile } from "../auto-derive";

const ROOT = join(import.meta.dir, "..", "..", "..");

// ─── MVP Wizard Entry ──────────────────────────────────────────────────

export async function mvpNewProject(db: Database): Promise<void> {
  console.log("");
  console.log("  " + badge("✦ PMM-AI — New Project", "blue"));
  console.log("");
  console.log("  Describe what you want to build. Plain English. No tech jargon needed.");
  console.log("");

  // Step 1: The one question
  process.stdout.write("  What are you building? > ");
  let description = "";
  for await (const line of console) {
    description = line.trim();
    break;
  }

  if (!description) {
    console.log("");
    console.log("  " + badge("Cancelled", "dim") + " No description provided.");
    return;
  }

  console.log("");
  divider("Analyzing", 50);

  // Step 2: Auto-derive everything
  const profile = derive(description);

  console.log("");
  console.log("  " + badge(profile.type, "green"));
  console.log("  Language:  " + profile.language);
  if (profile.framework) console.log("  Framework: " + profile.framework);
  console.log("  Complexity: " + profile.complexity + " (est. " + profile.est_milestones + " milestones)");
  console.log("  Layers: " + profile.layer_count + " — " + profile.layer_names.join(" → "));

  // Step 3: Extract a project name
  const projectName = extractProjectName(description);

  console.log("");
  process.stdout.write("  Project name [" + projectName + "]: ");
  let nameInput = "";
  for await (const line of console) {
    nameInput = line.trim();
    break;
  }
  const finalName = nameInput || projectName;

  // Check if already exists
  const existing = queryOne(db, "SELECT id FROM projects WHERE name = ?", [finalName]) as any;
  if (existing) {
    console.log("");
    console.log("  " + badge("Already exists!", "yellow") + " Project \"" + finalName + "\" is already registered.");
    console.log("  Run: bun PMM-AI/scripts/cli.ts view " + finalName);
    return;
  }

  // Step 4: Confirm
  console.log("");
  divider("Ready", 50);
  console.log("");
  console.log("  Project:    " + badge(finalName, "blue"));
  console.log("  Type:       " + profile.type);
  console.log("  Complexity: " + profile.complexity + " (est. " + profile.est_milestones + " milestones, ≤" + profile.caps.max_features + " features)");
  console.log("  Auto-swarm: " + profile.layer_count + " agent layers");
  console.log("");

  process.stdout.write("  Create this project? [Y/n]: ");
  let confirm = "";
  for await (const line of console) {
    confirm = line.trim().toLowerCase();
    break;
  }
  if (confirm === "n" || confirm === "no") {
    console.log("  " + badge("Cancelled", "dim"));
    return;
  }

  // Step 5: Register project
  console.log("");
  divider("Creating", 50);

  const stack = [profile.language];
  if (profile.framework) stack.push(profile.framework);

  run(db,
    `INSERT INTO projects (name, phase, priority, status, health, tech_stack, repo_path, created_at, updated_at)
     VALUES (?, 'design', ?, 'active', 'healthy', ?, ?, datetime('now'), datetime('now'))`,
    [finalName, profile.complexity === "complex" ? "high" : "medium", stack.join(", "),
     join(ROOT, "PMM", finalName.replace(/[^a-zA-Z0-9_-]/g, "_"))],
  );

  const pid = getProjectIdOrFail(db, finalName);

  // Step 6: Auto-configure swarm (hidden complexity)
  autoConfigureSwarm(db, pid, profile);

  // Step 7: Generate MVP milestone placeholder
  const msNames = generateMilestoneNames(profile, description);
  for (const name of msNames) {
    run(db, "INSERT INTO milestones (project_id, name, status) VALUES (?, ?, 'pending')", [pid, name]);
  }

  console.log("");
  console.log("  " + badge("✓ Created", "green"));
  console.log("  Project:    " + finalName);
  console.log("  Phase:      design → ready to plan");
  console.log("  Milestones: " + msNames.length + " (auto-generated)");
  console.log("  Swarm:      " + profile.layer_count + " layers configured");

  // Step 8: Show next steps
  console.log("");
  divider("Next steps", 50);
  console.log("");
  console.log("  " + badge("1", "blue") + " View dashboard:  bun PMM-AI/scripts/cli.ts view " + finalName);
  console.log("  " + badge("2", "blue") + " Start building:  bun PMM-AI/scripts/cli.ts swarm deploy " + finalName);
  console.log("  " + badge("3", "blue") + " Check health:    bun PMM-AI/scripts/cli.ts health");
  console.log("  " + badge("★", "green") + " Live dashboard:  open http://localhost:9998");
  console.log("");

  // Step 9: Offer to generate full plan
  process.stdout.write("  Generate detailed plan now? (milestones, features, tasks) [Y/n]: ");
  let planConfirm = "";
  for await (const line of console) {
    planConfirm = line.trim().toLowerCase();
    break;
  }

  if (planConfirm !== "n" && planConfirm !== "no") {
    console.log("");
    console.log("  " + badge("→", "green") + " Generating plan... (delegating to planner)");
    await generateMVPPlan(db, finalName, profile, description);
  }
}

// ─── Name Extraction ───────────────────────────────────────────────────

function extractProjectName(description: string): string {
  // Simple heuristics
  const lower = description.toLowerCase();
  const patterns = [
    /(?:build|create|make|develop)\s+(?:a|an)\s+(.+?)(?:\s+with|\s+using|\s+that|\s+in\s|$)/i,
    /(?:a|an)\s+(.+?)(?:\s+app|\s+tool|\s+system|\s+platform|\s+dashboard)/i,
  ];

  for (const p of patterns) {
    const m = description.match(p);
    if (m?.[1]) {
      const name = m[1].trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 40);
      if (name.length > 2) return name;
    }
  }

  // Fallback: first 3 meaningful words
  const words = description
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => !["a", "an", "the", "i", "want", "to", "build", "create", "make", "develop"].includes(w));
  return words.slice(0, 3).join("-") || "new-project";
}

// ─── Milestone Generation ─────────────────────────────────────────────

function generateMilestoneNames(profile: ProjectProfile, description: string): string[] {
  const names: string[] = [];

  // Scaffold milestone
  names.push("Project Scaffold & Setup");

  // Type-specific milestones
  switch (profile.type) {
    case "full-stack web app":
      names.push("Data Model & Database Schema");
      names.push("Core API Routes");
      names.push("Frontend UI Shell");
      names.push("Authentication & User Management");
      names.push("Integration & Testing");
      break;
    case "REST API":
      names.push("Data Model & Schema");
      names.push("Core Endpoints");
      names.push("Authentication & Middleware");
      names.push("Testing & Documentation");
      break;
    case "CLI tool":
      names.push("Command Structure & Args");
      names.push("Core Logic Implementation");
      names.push("Build & Distribution");
      break;
    case "Chrome extension":
      names.push("Extension Shell & Manifest");
      names.push("Core Features");
      names.push("Permissions & Publishing");
      break;
    case "dashboard":
      names.push("Data Source Integration");
      names.push("Chart Components");
      names.push("Layout & Interactivity");
      break;
    case "data pipeline":
      names.push("Data Ingestion");
      names.push("Transformation Logic");
      names.push("Validation & Monitoring");
      break;
    default:
      names.push("Core Feature Implementation");
      names.push("Testing & Validation");
      if (profile.est_milestones >= 6) names.push("Polish & Documentation");
  }

  // Gate: enforce cap
  while (names.length > profile.caps.max_milestones) {
    names.pop();
  }

  // Prefix count
  return names.map((n, i) => `${i + 1}. ${n}`);
}

// ─── Plan Generation ───────────────────────────────────────────────────

async function generateMVPPlan(
  db: Database,
  projectName: string,
  profile: ProjectProfile,
  description: string,
): Promise<void> {
  const pid = getProjectIdOrFail(db, projectName);

  // Feature generation from description keywords
  const features = extractFeatures(description, profile);
  for (const f of features) {
    const gateErr = checkGate(profile, "features", features.length);
    if (gateErr) {
      console.log("  " + badge("⚠", "yellow") + " " + gateErr);
      break;
    }
    const ms = queryOne(db, "SELECT id FROM milestones WHERE project_id = ? ORDER BY id LIMIT 1 OFFSET ?",
      [pid, features.indexOf(f) % profile.est_milestones]) as any;
    run(db,
      "INSERT INTO features (project_id, name, description, priority, milestone_id, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [pid, f.name, f.description, f.priority || "medium", ms?.id ?? null],
    );
  }

  // Task generation for first milestone
  const firstMs = queryOne(db, "SELECT id FROM milestones WHERE project_id = ? ORDER BY id LIMIT 1", [pid]) as any;
  if (firstMs) {
    const tasks = ["Initialize project structure", "Set up development environment",
      "Configure linter and formatter", "Set up CI pipeline", "Write README"];
    for (const t of tasks) {
      const gateErr = checkGate(profile, "tasks", tasks.length);
      if (gateErr) { console.log("  " + badge("⚠", "yellow") + " " + gateErr); break; }
      run(db, "INSERT INTO atomic_tasks (project_id, name, status, milestone_id, methods) VALUES (?, ?, 'pending', ?, 'pmm-auto')",
        [pid, t, firstMs.id]);
    }
  }

  const msCount = (queryOne(db, "SELECT COUNT(*) as c FROM milestones WHERE project_id = ?", [pid]) as any)?.c ?? 0;
  const feCount = (queryOne(db, "SELECT COUNT(*) as c FROM features WHERE project_id = ?", [pid]) as any)?.c ?? 0;
  const taskCount = (queryOne(db, "SELECT COUNT(*) as c FROM atomic_tasks WHERE project_id = ?", [pid]) as any)?.c ?? 0;

  console.log("");
  console.log("  " + badge("✓ Plan generated", "green"));
  console.log("  Milestones: " + msCount + " | Features: " + feCount + " | Tasks: " + taskCount);
  console.log("  Run: bun PMM-AI/scripts/cli.ts view " + projectName + " to see it.");
}

// ─── Feature Extraction ────────────────────────────────────────────────

function extractFeatures(description: string, profile: ProjectProfile): { name: string; description: string; priority: string }[] {
  const features: { name: string; description: string; priority: string }[] = [];
  const lower = description.toLowerCase();

  // Keyword → feature mapping
  const signals: [string, string, string][] = [
    ["auth", "User Authentication", "critical"],
    ["login", "User Authentication", "critical"],
    ["user", "User Management", "high"],
    ["profile", "User Profiles", "medium"],
    ["social", "Social Features", "medium"],
    ["share", "Sharing & Export", "medium"],
    ["dashboard", "Dashboard View", "high"],
    ["chart", "Charts & Analytics", "medium"],
    ["analytics", "Analytics & Reporting", "medium"],
    ["notification", "Notifications", "medium"],
    ["email", "Email Integration", "medium"],
    ["payment", "Payment Processing", "critical"],
    ["stripe", "Payment Processing", "critical"],
    ["upload", "File Upload", "medium"],
    ["image", "Image Handling", "medium"],
    ["search", "Search Functionality", "high"],
    ["filter", "Filtering & Sorting", "medium"],
    ["api", "REST API", "critical"],
    ["database", "Data Persistence", "critical"],
    ["sync", "Data Synchronization", "high"],
    ["realtime", "Real-time Updates", "high"],
    ["mobile", "Mobile Responsive", "high"],
    ["dark mode", "Dark Mode Support", "low"],
    ["theme", "Theme Customization", "low"],
    ["track", "Tracking & Logging", "high"],
    ["report", "Reporting", "medium"],
  ];

  const seen = new Set<string>();
  for (const [keyword, name, priority] of signals) {
    if (lower.includes(keyword) && !seen.has(name)) {
      seen.add(name);
      features.push({ name, description: `${name} for the ${profile.type}`, priority });
    }
  }

  // Ensure minimum features
  if (features.length < 2) {
    features.push(
      { name: "Core Data Model", description: "Database schema and models", priority: "critical" },
      { name: "User Interface", description: "Main UI components and layout", priority: "high" },
      { name: "API Layer", description: "Backend API endpoints", priority: "critical" },
    );
  }

  // Complexity gate
  const max = profile.caps.max_features;
  if (features.length > max) {
    console.log("  " + badge("⚠", "yellow") + " " + features.length + " features detected, capping at " + max + " (MVP scope)");
    return features.slice(0, max);
  }

  return features.slice(0, profile.caps.max_features);
}
