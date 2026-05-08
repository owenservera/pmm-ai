/**
 * PMM-AI Auto-Derivation Engine
 * ==============================
 * Infers swarm configuration, complexity caps, and routing codes
 * from natural language project descriptions. No user flags needed.
 *
 * This is the "smart defaults" layer that hides infrastructure complexity
 * from vibe coders. They describe an app → we derive everything.
 */
import type { Database } from "bun:sqlite";

// ─── Type Inference ──────────────────────────────────────────────────

export interface ProjectProfile {
  /** Human-readable project type label */
  type: "full-stack web app" | "REST API" | "CLI tool" | "Chrome extension"
    | "mobile app" | "data pipeline" | "library/SDK" | "dashboard"
    | "automation/scripts" | "AI/ML system" | "game" | "unknown";
  /** Primary language */
  language: string;
  /** Detected framework */
  framework: string | null;
  /** Complexity tier */
  complexity: "simple" | "medium" | "complex";
  /** Estimated milestone count */
  est_milestones: number;
  /** Recommended routing code */
  routing_code: 0 | 1 | 3 | 5 | 7 | 9 | 11 | 13 | 15 | 17;
  /** Recommended layer count */
  layer_count: number;
  /** Layer names */
  layer_names: string[];
  /** Hard caps */
  caps: {
    max_milestones: number;
    max_features: number;
    max_tasks: number;
    max_layers: number;
  };
}

// ─── Keyword → Type Mapping ──────────────────────────────────────────

const TYPE_SIGNALS: Record<string, ProjectProfile["type"]> = {
  "web app": "full-stack web app", "website": "full-stack web app",
  "saas": "full-stack web app", "full-stack": "full-stack web app",
  "frontend": "full-stack web app", "backend": "full-stack web app",
  "react": "full-stack web app", "next": "full-stack web app",
  "vue": "full-stack web app", "svelte": "full-stack web app",
  "api": "REST API", "rest": "REST API", "endpoint": "REST API",
  "server": "REST API", "graphql": "REST API",
  "cli": "CLI tool", "command": "CLI tool", "terminal": "CLI tool",
  "extension": "Chrome extension", "chrome": "Chrome extension",
  "browser": "Chrome extension", "plugin": "Chrome extension",
  "mobile": "mobile app", "ios": "mobile app", "android": "mobile app",
  "react native": "mobile app", "expo": "mobile app", "flutter": "mobile app",
  "pipeline": "data pipeline", "etl": "data pipeline",
  "data": "data pipeline", "stream": "data pipeline",
  "library": "library/SDK", "sdk": "library/SDK", "package": "library/SDK",
  "dashboard": "dashboard", "admin": "dashboard", "analytics": "dashboard",
  "bot": "automation/scripts", "script": "automation/scripts",
  "automation": "automation/scripts", "workflow": "automation/scripts",
  "ai": "AI/ML system", "ml": "AI/ML system", "model": "AI/ML system",
  "llm": "AI/ML system", "neural": "AI/ML system",
  "game": "game",
};

const LANGUAGE_SIGNALS: Record<string, string> = {
  "typescript": "TypeScript", "ts": "TypeScript", "javascript": "JavaScript",
  "js": "JavaScript", "python": "Python", "py": "Python",
  "rust": "Rust", "rs": "Rust", "go": "Go", "golang": "Go",
  "java": "Java", "kotlin": "Kotlin", "swift": "Swift",
  "ruby": "Ruby", "php": "PHP", "c#": "C#", "c++": "C++",
  "bun": "TypeScript (Bun)", "node": "TypeScript (Node)",
  "deno": "TypeScript (Deno)",
};

const FRAMEWORK_SIGNALS: Record<string, string> = {
  "react": "React", "next.js": "Next.js", "next": "Next.js",
  "vue": "Vue", "svelte": "Svelte", "angular": "Angular",
  "express": "Express", "fastify": "Fastify", "hono": "Hono",
  "django": "Django", "flask": "Flask", "fastapi": "FastAPI",
  "rails": "Rails", "laravel": "Laravel",
  "flutter": "Flutter", "react native": "React Native",
  "expo": "Expo", "electron": "Electron",
  "sqlite": "SQLite", "postgres": "PostgreSQL",
};

// ─── Complexity Tiers ─────────────────────────────────────────────────

interface ComplexityTier {
  tier: "simple" | "medium" | "complex";
  routing_code: ProjectProfile["routing_code"];
  layers: number;
  layer_names: string[];
  caps: ProjectProfile["caps"];
}

const COMPLEXITY_TABLE: Record<string, ComplexityTier> = {
  "full-stack web app": {
    tier: "medium", routing_code: 3, layers: 3,
    layer_names: ["Plan & Scaffold", "Core Features", "Polish & Ship"],
    caps: { max_milestones: 10, max_features: 16, max_tasks: 40, max_layers: 3 },
  },
  "REST API": {
    tier: "simple", routing_code: 1, layers: 2,
    layer_names: ["Data Model & Routes", "Tests & Docs"],
    caps: { max_milestones: 6, max_features: 10, max_tasks: 25, max_layers: 2 },
  },
  "CLI tool": {
    tier: "simple", routing_code: 0, layers: 2,
    layer_names: ["Commands & Flags", "Build & Distribute"],
    caps: { max_milestones: 5, max_features: 8, max_tasks: 20, max_layers: 2 },
  },
  "Chrome extension": {
    tier: "simple", routing_code: 1, layers: 2,
    layer_names: ["Extension Shell", "Features & Permissions"],
    caps: { max_milestones: 5, max_features: 8, max_tasks: 20, max_layers: 2 },
  },
  "mobile app": {
    tier: "medium", routing_code: 3, layers: 3,
    layer_names: ["Setup & Navigation", "Core Screens", "Polish & Ship"],
    caps: { max_milestones: 10, max_features: 16, max_tasks: 40, max_layers: 3 },
  },
  "data pipeline": {
    tier: "medium", routing_code: 7, layers: 2,
    layer_names: ["Ingest & Transform", "Validate & Monitor"],
    caps: { max_milestones: 6, max_features: 10, max_tasks: 30, max_layers: 2 },
  },
  "library/SDK": {
    tier: "simple", routing_code: 5, layers: 2,
    layer_names: ["API Design", "Tests & Publish"],
    caps: { max_milestones: 5, max_features: 8, max_tasks: 20, max_layers: 2 },
  },
  "dashboard": {
    tier: "simple", routing_code: 3, layers: 2,
    layer_names: ["Data + Charts", "Layout + Polish"],
    caps: { max_milestones: 5, max_features: 10, max_tasks: 25, max_layers: 2 },
  },
  "automation/scripts": {
    tier: "simple", routing_code: 0, layers: 1,
    layer_names: ["Automation Logic"],
    caps: { max_milestones: 3, max_features: 5, max_tasks: 12, max_layers: 1 },
  },
  "AI/ML system": {
    tier: "complex", routing_code: 3, layers: 3,
    layer_names: ["Data Pipeline", "Model Training", "Serving & API"],
    caps: { max_milestones: 12, max_features: 20, max_tasks: 50, max_layers: 3 },
  },
  "game": {
    tier: "complex", routing_code: 3, layers: 3,
    layer_names: ["Core Mechanics", "Content & Levels", "Polish & Ship"],
    caps: { max_milestones: 12, max_features: 20, max_tasks: 50, max_layers: 3 },
  },
  "unknown": {
    tier: "medium", routing_code: 3, layers: 3,
    layer_names: ["Design & Plan", "Core Features", "Tests & Ship"],
    caps: { max_milestones: 8, max_features: 12, max_tasks: 30, max_layers: 3 },
  },
};

// ─── Public API ───────────────────────────────────────────────────────

/** Derive a complete project profile from a natural language description. */
export function derive(description: string, repoPath?: string): ProjectProfile {
  const lower = description.toLowerCase();

  // Detect type
  let type: ProjectProfile["type"] = "unknown";
  let typeScore = 0;
  for (const [keyword, t] of Object.entries(TYPE_SIGNALS)) {
    if (lower.includes(keyword) && keyword.length > typeScore) {
      type = t;
      typeScore = keyword.length;
    }
  }

  // Detect language
  let language = "TypeScript";
  let langScore = 0;
  for (const [keyword, lang] of Object.entries(LANGUAGE_SIGNALS)) {
    if (lower.includes(keyword) && keyword.length > langScore) {
      language = lang;
      langScore = keyword.length;
    }
  }

  // Detect framework
  let framework: string | null = null;
  let fwScore = 0;
  for (const [keyword, fw] of Object.entries(FRAMEWORK_SIGNALS)) {
    if (lower.includes(keyword) && keyword.length > fwScore) {
      framework = fw;
      fwScore = keyword.length;
    }
  }

  // Look up complexity tier
  const tier = COMPLEXITY_TABLE[type] ?? COMPLEXITY_TABLE["unknown"]!;

  // Estimate milestones from description length and complexity
  const wordCount = description.split(/\s+/).length;
  let baseMilestones = wordCount > 20 ? 8 : wordCount > 10 ? 6 : 4;
  if (tier.tier === "complex") baseMilestones = Math.min(baseMilestones + 2, tier.caps.max_milestones);
  if (tier.tier === "simple") baseMilestones = Math.min(baseMilestones - 1, tier.caps.max_milestones);

  return {
    type,
    language,
    framework,
    complexity: tier.tier,
    est_milestones: Math.max(2, baseMilestones),
    routing_code: tier.routing_code,
    layer_count: tier.layers,
    layer_names: tier.layer_names,
    caps: tier.caps,
  };
}

/**
 * Register auto-derived swarm layers for a project.
 */
export function autoConfigureSwarm(
  db: Database,
  projectId: number,
  profile: ProjectProfile,
  consensus = "L0-authority",
  topology = "hierarchical",
): void {
  const existing = db.query("SELECT layer_num FROM agent_layers WHERE project_id = ?")
    .all(projectId) as any[];
  const existingNums = new Set(existing.map((l: any) => l.layer_num));

  for (let i = 0; i < profile.layer_count; i++) {
    if (!existingNums.has(i)) {
      db.run(
        `INSERT INTO agent_layers (project_id, layer_num, name, topology, consensus)
         VALUES (?, ?, ?, ?, ?)`,
        [projectId, i, profile.layer_names[i] ?? `Layer ${i}`, topology, consensus],
      );
    }
  }
}

/**
 * Get the complexity gate error message if a value exceeds the cap.
 * Returns null if within bounds.
 */
export function checkGate(
  profile: ProjectProfile,
  metric: "milestones" | "features" | "tasks" | "layers",
  actual: number,
): string | null {
  const cap = metric === "milestones" ? profile.caps.max_milestones
    : metric === "features" ? profile.caps.max_features
    : metric === "tasks" ? profile.caps.max_tasks
    : profile.caps.max_layers;

  if (actual > cap) {
    return `Scope gate: ${actual} ${metric} exceeds MVP cap of ${cap}. Split into phases?`;
  }
  return null;
}
