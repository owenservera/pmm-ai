/**
 * PMM-AI MVP Scoping — Scenario 3
 * ================================
 * "Show me the fastest path to something I can show users."
 *
 * Auto-triages features by impact/effort, strips to MVP core,
 * and produces a phased roadmap. Complexity-gated.
 *
 * Usage:
 *   pmm-ai mvp <project>           MVP scoping report
 *   pmm-ai mvp <project> --apply   Apply phase tags to features
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne, run, getProjectIdOrFail } from "../db";
import { badge, divider } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {
  "mvp": async (db, args) => {
    const projectName = args[0];
    if (!projectName) {
      console.log("");
      console.log("  " + badge("Usage", "dim") + " pmm-ai mvp <project>");
      console.log("  " + badge("Flags", "dim") + " --apply   Apply phase tags to features");
      console.log("");
      return;
    }
    await scopeProject(db, projectName, args.includes("--apply"));
  },
};

// ─── MVP Scoping Engine ─────────────────────────────────────────────────

async function scopeProject(db: Database, projectName: string, apply: boolean) {
  const pid = getProjectIdOrFail(db, projectName);
  const project = queryOne(db, "SELECT name, phase, priority FROM projects WHERE id=?", [pid]) as any;

  const features = queryAll(db,
    "SELECT id, name, description, priority, status FROM features WHERE project_id=? ORDER BY priority, name", [pid]
  ) as any[];

  if (features.length === 0) {
    console.log("");
    console.log("  " + badge("No features", "yellow") + " — generate a plan first: pmm-ai plan " + projectName);
    console.log("");
    return;
  }

  // Score each feature by impact and effort
  const scored = features.map((f: any) => {
    const { impact, effort } = scoreFeature(f);
    const phase = triage(impact, effort);
    return { ...f, impact, effort, phase, score: impact / Math.max(effort, 1) };
  });

  // Sort by value (impact/effort ratio)
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  // Determine cut lines
  const mvpMax = Math.min(6, Math.ceil(features.length * 0.40)); // MVP = ~40% of features, max 6
  const phase2Max = Math.min(12, Math.ceil(features.length * 0.70)); // Phase 2 = next 30%
  const mvpFeatures = sorted.slice(0, mvpMax);
  const phase2Features = sorted.slice(mvpMax, phase2Max);
  const deferredFeatures = sorted.slice(phase2Max);

  console.log("");
  divider("MVP Scoping: " + project.name, 52);
  console.log("");

  // MVP core
  console.log("  " + badge("Phase 1 — MVP Core", "green") + "  (" + mvpFeatures.length + " features, ~" + estimateDays(mvpFeatures.length) + " days)");
  console.log("  " + "─".repeat(48));
  for (const f of mvpFeatures) {
    console.log("  " + fmtFeature(f));
  }
  console.log("");

  // Phase 2
  if (phase2Features.length > 0) {
    console.log("  " + badge("Phase 2 — Growth", "yellow") + "  (" + phase2Features.length + " features)");
    for (const f of phase2Features) {
      console.log("  " + fmtFeature(f));
    }
    console.log("");
  }

  // Deferred
  if (deferredFeatures.length > 0) {
    console.log("  " + badge("Phase 3 — Polish", "dim") + "  (" + deferredFeatures.length + " features)");
    for (const f of deferredFeatures.slice(0, 5)) {
      console.log("  " + fmtFeature(f));
    }
    if (deferredFeatures.length > 5) {
      console.log("  \x1b[2m  ... and " + (deferredFeatures.length - 5) + " more\x1b[0m");
    }
    console.log("");
  }

  // Summary
  const complexityGate = mvpFeatures.length <= 6 ? badge("OK", "green") : badge("EXCEEDED", "red");
  console.log("  " + badge("Complexity Gate", "blue") + "  " + complexityGate + "  ≤6 MVP features recommended");
  console.log("");
  console.log("  MVP path:   " + mvpFeatures.length + " features  |  Est. " + estimateDays(mvpFeatures.length) + " days");
  console.log("  Full scope: " + features.length + " features  |  Est. " + estimateDays(features.length) + " days");
  console.log("  Savings:    " + (features.length - mvpFeatures.length) + " features cut from MVP (" + Math.round((1 - mvpFeatures.length / features.length) * 100) + "% reduction)");
  console.log("");

  // Apply phase tags if requested
  if (apply) {
    for (const f of mvpFeatures) {
      run(db, "UPDATE features SET component='phase-1' WHERE id=?", [f.id]);
    }
    for (const f of phase2Features) {
      run(db, "UPDATE features SET component='phase-2' WHERE id=?", [f.id]);
    }
    for (const f of deferredFeatures) {
      run(db, "UPDATE features SET component='phase-3' WHERE id=?", [f.id]);
    }
    console.log("  " + badge("✓ Applied", "green") + " Phase tags written to features.component (phase-1/2/3)");
    console.log("");
  } else {
    console.log("  Run " + badge("pmm-ai mvp " + projectName + " --apply", "green") + " to tag features with phases.");
    console.log("");
  }

  // Swarm hint
  console.log("  " + badge("Build MVP", "blue") + "  pmm-ai swarm deploy " + projectName + " --mvp");
  console.log("  (--mvp flag filters to phase-1 features only)");
  console.log("");
}

// ─── Scoring Engine ─────────────────────────────────────────────────────

function scoreFeature(feature: any): { impact: number; effort: number } {
  const name = (feature.name || "").toLowerCase();
  const desc = (feature.description || "").toLowerCase();
  const text = name + " " + desc;
  let impact = 3; // default medium
  let effort = 3; // default medium

  // Impact keywords
  const highImpact = ["auth", "authentication", "login", "core", "database", "data model",
    "api", "payment", "checkout", "workout", "tracking", "logging", "dashboard", "crud"];
  const criticalImpact = ["critical", "essential", "required", "must have", "mvp", "launch",
    "security", "encryption", "compliance"];
  const lowImpact = ["dark mode", "theme", "export", "import", "notification", "email digest",
    "cosmetic", "animation", "transition", "social share"];

  if (criticalImpact.some(k => text.includes(k))) impact = 5;
  else if (highImpact.some(k => text.includes(k))) impact = 4;
  else if (lowImpact.some(k => text.includes(k))) impact = 2;

  // Priority overrides
  if (feature.priority === "critical") impact = Math.max(impact, 4);
  if (feature.priority === "low") impact = Math.min(impact, 2);

  // Effort keywords
  const highEffort = ["machine learning", "ai", "real-time", "real time", "websocket",
    "streaming", "payment integration", "third party", "oauth", "migration",
    "search engine", "full text", "video", "media processing"];
  const lowEffort = ["config", "settings", "toggle", "filter", "sort", "simple",
    "read-only", "display", "list", "view", "badge", "label"];

  if (highEffort.some(k => text.includes(k))) effort = 5;
  else if (lowEffort.some(k => text.includes(k))) effort = 2;

  // Name length heuristics (longer = more complex)
  if (name.length > 40) effort += 1;
  if (desc.length > 100) effort += 1;

  return { impact, effort: Math.min(5, effort) };
}

function triage(impact: number, effort: number): "phase-1" | "phase-2" | "phase-3" {
  const value = impact / Math.max(effort, 1);
  if (value >= 1.5) return "phase-1";
  if (value >= 0.8) return "phase-2";
  return "phase-3";
}

function fmtFeature(f: any): string {
  const impBar = "█".repeat(f.impact) + "░".repeat(5 - f.impact);
  const effBar = "█".repeat(f.effort) + "░".repeat(5 - f.effort);
  const icon = f.phase === "phase-1" ? "\x1b[32m●\x1b[0m" : f.phase === "phase-2" ? "\x1b[33m○\x1b[0m" : "\x1b[2m·\x1b[0m";
  return icon + " \x1b[2mI[" + impBar + "] E[" + effBar + "]\x1b[0m " + f.name.slice(0, 45);
}

function estimateDays(featureCount: number): number {
  return Math.ceil(featureCount * 1.5); // rough: 1-2 days per feature
}
