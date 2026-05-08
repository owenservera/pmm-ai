// PMM Process Awareness — Environment + Artifact Scanner
// ======================================================
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openDb, queryAll, queryOne } from "../db";
import type { Artifact, MethodologyRecord, PMMState, ProcessScanResult } from "./types";

const WORKSPACE_ROOT = join(import.meta.dir, "..", "..", "..");

// ── Environment Detection ──────────────────────────────

function detectActiveMethodologies(db: ReturnType<typeof openDb>): MethodologyRecord[] {
  const rows = queryAll(
    db,
    "SELECT * FROM methodologies WHERE enabled = 1 ORDER BY priority DESC",
  ) as any[];
  const active: MethodologyRecord[] = [];

  for (const row of rows) {
    const signals = JSON.parse(row.detection_signals);
    let matched = false;

    if (signals.skills) {
      for (const pattern of signals.skills as string[]) {
        const path = join(WORKSPACE_ROOT, pattern);
        if (existsSync(path)) { matched = true; break; }
      }
    }

    if (!matched && signals.directories) {
      for (const pattern of signals.directories as string[]) {
        const path = join(WORKSPACE_ROOT, pattern);
        if (existsSync(path)) { matched = true; break; }
      }
    }

    if (matched) {
      active.push({
        id: row.id,
        name: row.name,
        description: row.description,
        detection_signals: signals,
        artifact_mappings: JSON.parse(row.artifact_mappings),
        phase_rules: row.phase_rules ? JSON.parse(row.phase_rules) : null,
        priority: row.priority,
        enabled: row.enabled,
      });
    }
  }

  return active;
}

// ── Artifact Scanning ──────────────────────────────────

function walkDir(dir: string, results: string[], root: string) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, results, root);
      } else if (entry.name.endsWith(".md")) {
        results.push(fullPath.replace(root, "").replace(/^[\\/]/, "").replace(/\\/g, "/"));
      }
    }
  } catch { /* dir not readable */ }
}

function matchSimple(pattern: string, name: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
  );
  return regex.test(name);
}

function globPattern(pattern: string, root: string): string[] {
  const results: string[] = [];

  if (pattern.includes("**")) {
    const base = pattern.replace(/\*\*\/?\*?\.?(\w+)?/, "");
    const dirPath = join(root, base.replace(/\/$/, ""));
    if (existsSync(dirPath)) {
      walkDir(dirPath, results, root);
    }
  } else if (pattern.includes("*")) {
    const lastSlash = pattern.lastIndexOf("/");
    const dir = pattern.slice(0, lastSlash);
    const filePattern = pattern.slice(lastSlash + 1);
    const dirPath = join(root, dir);
    if (existsSync(dirPath)) {
      try {
        const entries = readdirSync(dirPath);
        for (const entry of entries) {
          if (matchSimple(filePattern, entry)) {
            results.push(join(dir, entry).replace(/\\/g, "/"));
          }
        }
      } catch { /* dir not readable */ }
    }
  } else {
    const fullPath = join(root, pattern).replace(/\\/g, "/");
    if (existsSync(fullPath)) results.push(pattern);
  }

  return results;
}

function scanArtifacts(methodologies: MethodologyRecord[], root: string): Artifact[] {
  const seen = new Set<string>();
  const artifacts: Artifact[] = [];

  for (const method of methodologies) {
    for (const [type, mapping] of Object.entries(method.artifact_mappings)) {
      for (const pattern of mapping.patterns) {
        const matches = globPattern(pattern, root);
        for (const match of matches) {
          if (!seen.has(match)) {
            seen.add(match);
            artifacts.push({
              path: match,
              type,
              methodology: method.name,
              extracted_at: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  const order = ["spec", "plan", "project_doc", "architecture_doc", "readme"];
  artifacts.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return artifacts;
}

// ── PMM State Query ────────────────────────────────────

function queryPMMState(db: ReturnType<typeof openDb>, artifacts: Artifact[]): PMMState {
  let projectName: string | null = null;
  let projectId: number | null = null;

  for (const a of artifacts) {
    if (a.type === "project_doc") {
      const match = a.path.match(/PMM\/(.+?)\/project\.md/);
      if (match) projectName = match[1]!;
    } else if (a.type === "spec") {
      const match = a.path.match(/\d{4}-\d{2}-\d{2}-(.+?)-design\.md$/);
      if (match && !projectName) projectName = match[1]!.replace(/-/g, " ");
    }
  }

  if (projectName) {
    const p = queryOne(db, "SELECT id, name FROM projects WHERE name LIKE ?", [`%${projectName}%`]) as any;
    if (p) {
      projectId = p.id;
      projectName = p.name;
    }
  }

  const state: PMMState = {
    registered: projectId !== null,
    project_id: projectId,
    project_name: projectName,
    milestone_count: 0,
    feature_count: 0,
    task_count: 0,
    decision_count: 0,
  };

  if (projectId) {
    state.milestone_count = (queryOne(db, "SELECT COUNT(*) as c FROM milestones WHERE project_id = ?", [projectId]) as any).c;
    state.feature_count = (queryOne(db, "SELECT COUNT(*) as c FROM features WHERE project_id = ?", [projectId]) as any).c;
    state.task_count = (queryOne(db, "SELECT COUNT(*) as c FROM atomic_tasks WHERE project_id = ?", [projectId]) as any).c;
    state.decision_count = (queryOne(db, "SELECT COUNT(*) as c FROM decisions WHERE project_id = ?", [projectId]) as any).c;
  }

  return state;
}

// ── Phase Detection ────────────────────────────────────

function determinePhase(
  _methodologies: MethodologyRecord[],
  artifacts: Artifact[],
  pmmState: PMMState,
): { phase: string; confidence: number } {
  const hasSpec = artifacts.some(a => a.type === "spec");
  const hasAnyDoc = artifacts.length > 0;

  if (pmmState.registered && pmmState.milestone_count > 0 && hasSpec) {
    return { phase: "build", confidence: 0.95 };
  }
  if (pmmState.registered && hasSpec) {
    return { phase: "define", confidence: 0.85 };
  }
  if (hasSpec && !pmmState.registered) {
    return { phase: "design", confidence: 0.85 };
  }
  if (hasAnyDoc && !pmmState.registered) {
    return { phase: "design", confidence: 0.70 };
  }
  if (!hasAnyDoc && !pmmState.registered) {
    return { phase: "discover", confidence: 0.50 };
  }
  if (pmmState.registered && pmmState.milestone_count > 0) {
    return { phase: "build", confidence: 0.70 };
  }

  return { phase: "discover", confidence: 0.30 };
}

// ── Gap Detection ──────────────────────────────────────

function detectGaps(
  artifacts: Artifact[],
  pmmState: PMMState,
): ProcessScanResult["gaps"] {
  const gaps: ProcessScanResult["gaps"] = [];

  if (!pmmState.registered && artifacts.length > 0) {
    const specArtifact = artifacts.find(a => a.type === "spec" || a.type === "project_doc");
    gaps.push({
      type: "registration",
      description: `Artifacts found but project not registered in PMM DB`,
      auto_fixable: specArtifact !== undefined,
      source_artifact: specArtifact?.path ?? null,
    });
  }

  if (pmmState.registered && pmmState.milestone_count === 0) {
    gaps.push({
      type: "milestones",
      description: `Project "${pmmState.project_name}" has no milestones`,
      auto_fixable: artifacts.some(a => a.type === "spec" || a.type === "plan"),
      source_artifact: artifacts.find(a => a.type === "plan")?.path ?? artifacts.find(a => a.type === "spec")?.path ?? null,
    });
  }

  if (pmmState.registered && pmmState.feature_count === 0) {
    gaps.push({
      type: "features",
      description: `Project "${pmmState.project_name}" has no features`,
      auto_fixable: artifacts.some(a => a.type === "spec"),
      source_artifact: artifacts.find(a => a.type === "spec")?.path ?? null,
    });
  }

  // ── Consolidation drift checks ──────────────────────────
  const dualSourceGap = detectConsolidationDrift();
  if (dualSourceGap) gaps.push(dualSourceGap);

  return gaps;
}

// ── Consolidation Drift Detection ──────────────────────

function detectConsolidationDrift(): ProcessScanResult["gaps"][number] | null {
  const root = join(import.meta.dir, "..", "..", "..");
  const legacyDir = join(root, "src", "pmm");
  const canonicalDir = join(root, "PMM-AI", "src");
  const legacyExists = existsSync(legacyDir);
  const canonicalExists = existsSync(canonicalDir);

  if (legacyExists && canonicalExists) {
    // Dual-source drift detected — both codebases exist
    const stragglers: string[] = [];
    const knownStragglers = [
      "pmm.backup.ts", "ruflo/", "ruflo-main/", "ruflo-main.zip",
      ".antigravity/", "GEMINI.md", "nul",
      "centralized_nervous_system_architecture.md",
      "cns_parallel_execution_plan.md",
      "tmp-decisions.json", "tmp-ext-decisions.json",
      "PMM/pmm.db-shm", "PMM/pmm.db-wal", "PMM/pmm.db.cns-pre.bak",
    ];
    for (const s of knownStragglers) {
      if (existsSync(join(root, s))) stragglers.push(s);
    }

    const detailParts = ["Dual PMM source detected: src/pmm/ (legacy) and PMM-AI/src/ (canonical)."];
    if (stragglers.length > 0) {
      detailParts.push(`${stragglers.length} straggler file(s): ${stragglers.slice(0, 5).join(", ")}${stragglers.length > 5 ? "..." : ""}`);
    }

    return {
      type: "consolidation_drift",
      description: detailParts.join(" "),
      auto_fixable: false,
      source_artifact: "src/pmm/ → PMM-AI/src/ consolidation",
    };
  }

  if (!canonicalExists) {
    return {
      type: "consolidation_drift",
      description: "PMM-AI canonical source directory missing",
      auto_fixable: false,
      source_artifact: null,
    };
  }

  return null;
}

// ── Main Entry Point ───────────────────────────────────

export function processScan(): ProcessScanResult {
  const db = openDb();
  try {
    const methodologies = detectActiveMethodologies(db);
    const artifacts = scanArtifacts(methodologies, WORKSPACE_ROOT);
    const pmmState = queryPMMState(db, artifacts);
    const { phase, confidence } = determinePhase(methodologies, artifacts, pmmState);
    const gaps = detectGaps(artifacts, pmmState);

    let harness = "unknown";
    try {
      const ha = queryOne(db, "SELECT name FROM harness_adapters WHERE status = 'active' LIMIT 1") as any;
      if (ha) harness = ha.name;
    } catch { /* harness_adapters may not exist */ }

    return {
      environment: {
        active_methodologies: methodologies.map(m => m.name),
        harness,
      },
      artifacts,
      pmm_state: pmmState,
      detected_phase: phase,
      gaps,
      confidence,
      generated_at: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}
