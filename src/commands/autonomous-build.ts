/**
 * PMM Autonomous Build Pipeline
 * ==============================
 * "pmm-ai build <description>" — fully autonomous build pipeline from idea to deploy-ready plan.
 *
 * Pipeline: auto-derive profile -> register project -> generate milestones & features ->
 *           configure swarm layers -> register swarm tasks -> show deployment summary.
 *
 * Rust-translatable: all I/O is at the module boundary (db calls + console output);
 *                    derive/generation logic is pure.
 */
import type { Database } from "bun:sqlite";
import { derive, autoConfigureSwarm } from "../auto-derive";
import type { ProjectProfile } from "../auto-derive";
import { getProjectId, queryAll, queryOne, run } from "../db";
import { badge, divider } from "./shared";

// ─── Type-specific generation templates ─────────────────────────────────────

interface BuildTemplate {
  milestones: string[];
  featuresPerMilestone: Record<number, string[]>;
}

const BUILD_TEMPLATES: Record<string, BuildTemplate> = {
  "full-stack web app": {
    milestones: [
      "Data Model & Schema",
      "API & Backend Core",
      "Frontend UI Shell",
      "Core Feature Implementation",
      "Auth & Integration",
      "Testing & Polish",
    ],
    featuresPerMilestone: {
      0: ["Define data models", "Set up database schema"],
      1: ["Build REST/GraphQL API endpoints", "Implement service layer"],
      2: ["Create component tree & routing", "Build layout shell"],
      3: ["Implement primary user flows", "Add state management"],
      4: ["Add authentication & authorization", "Integrate third-party services"],
      5: ["Write tests", "Performance optimization & deploy"],
    },
  },
  "REST API": {
    milestones: [
      "Data Model & Schema",
      "Core Endpoints",
      "Middleware & Auth",
      "Tests & Documentation",
    ],
    featuresPerMilestone: {
      0: ["Design data models", "Set up database & migrations"],
      1: ["Implement CRUD endpoints", "Add query/filter support"],
      2: ["Add authentication middleware", "Error handling & validation"],
      3: ["Write integration tests", "Generate API documentation"],
    },
  },
  "CLI tool": {
    milestones: [
      "Commands & Flags",
      "Core Logic",
      "Build & Distribute",
    ],
    featuresPerMilestone: {
      0: ["Define CLI interface & flags", "Set up argument parsing"],
      1: ["Implement core commands", "Add output formatting"],
      2: ["Create build pipeline", "Package & publish"],
    },
  },
  "Chrome extension": {
    milestones: [
      "Extension Shell",
      "Core Features",
      "Permissions & Publish",
    ],
    featuresPerMilestone: {
      0: ["Set up manifest & popup", "Create background script"],
      1: ["Implement content scripts", "Build options page"],
      2: ["Configure permissions", "Package for Chrome Web Store"],
    },
  },
  "mobile app": {
    milestones: [
      "Project Setup & Navigation",
      "Core Screens",
      "Data & State",
      "Polish & Ship",
    ],
    featuresPerMilestone: {
      0: ["Initialize project & navigation", "Set up theming"],
      1: ["Build main screens", "Add screen transitions"],
      2: ["Implement data layer", "Add local persistence"],
      3: ["UI polish & animations", "App store preparation"],
    },
  },
  "data pipeline": {
    milestones: [
      "Ingest & Extract",
      "Transform & Load",
      "Validate & Monitor",
    ],
    featuresPerMilestone: {
      0: ["Set up data sources & ingestion", "Define extraction logic"],
      1: ["Implement transformation logic", "Configure data loading"],
      2: ["Add validation checks", "Set up monitoring & alerting"],
    },
  },
  "library/SDK": {
    milestones: [
      "API Design",
      "Core Implementation",
      "Tests & Publish",
    ],
    featuresPerMilestone: {
      0: ["Design public API surface", "Set up project structure"],
      1: ["Implement core methods", "Add error handling"],
      2: ["Write comprehensive tests", "Create docs & publish"],
    },
  },
  "dashboard": {
    milestones: [
      "Data Sources & Charts",
      "Layout & Navigation",
      "Interactivity & Polish",
    ],
    featuresPerMilestone: {
      0: ["Connect data sources", "Build chart components"],
      1: ["Create dashboard layout", "Add navigation & filters"],
      2: ["Add interactivity", "Responsive design & polish"],
    },
  },
  "automation/scripts": {
    milestones: [
      "Core Automation Logic",
      "Error Handling & Logging",
    ],
    featuresPerMilestone: {
      0: ["Implement automation workflow", "Define configuration"],
      1: ["Add error handling & retries", "Set up logging & notifications"],
    },
  },
  "AI/ML system": {
    milestones: [
      "Data Preparation",
      "Model Training",
      "Serving & API",
      "Evaluation & Iteration",
    ],
    featuresPerMilestone: {
      0: ["Collect & clean data", "Build preprocessing pipeline"],
      1: ["Train baseline model", "Hyperparameter tuning"],
      2: ["Create model serving API", "Add caching & batching"],
      3: ["Evaluate model performance", "Iterate on feedback"],
    },
  },
  "game": {
    milestones: [
      "Core Mechanics",
      "Content & Levels",
      "UI & Audio",
      "Polish & Ship",
    ],
    featuresPerMilestone: {
      0: ["Implement game loop & physics", "Build core mechanics"],
      1: ["Design levels & content", "Add game objects"],
      2: ["Build UI overlays", "Add audio & effects"],
      3: ["Performance optimization", "Testing & distribution"],
    },
  },
  "unknown": {
    milestones: [
      "Design & Plan",
      "Core Implementation",
      "Testing & Ship",
    ],
    featuresPerMilestone: {
      0: ["Design architecture & plan", "Set up project structure"],
      1: ["Implement core functionality", "Add essential features"],
      2: ["Write tests", "Polish & documentation"],
    },
  },
};

// ─── Helper: derive project name from description ───────────────────────────

function deriveProjectName(description: string, profile: ProjectProfile): string {
  // First try: use description keywords
  const cleaned = description
    .replace(/^(a|an|the|build|create|make)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .split(/\s+/)
    .slice(0, 3)
    .join("-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (cleaned && cleaned.length >= 3) return cleaned.slice(0, 30);

  // Fallback: use type abbreviation
  const typeSlug = profile.type
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();

  return typeSlug || `project-${Date.now().toString(36)}`;
}

// ─── Helper: extract significant keywords from description ───────────────────

function extractKeywords(description: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "with", "and", "or", "for", "to", "of", "in",
    "on", "at", "by", "is", "it", "be", "build", "create", "make",
    "simple", "basic", "that", "this", "app", "web", "api", "tool",
  ]);
  const words = description
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return words.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
}

// ─── Helper: generate milestone names ───────────────────────────────────────

function generateMilestones(description: string, profile: ProjectProfile): string[] {
  const template = BUILD_TEMPLATES[profile.type] ?? BUILD_TEMPLATES["unknown"]!;
  const keywords = extractKeywords(description);

  // Start with template's milestone list
  let milestones = [...template.milestones];

  // Add type-specific layer names as context if appropriate
  if (profile.complexity === "complex" && milestones.length < profile.layer_count) {
    for (const ln of profile.layer_names) {
      if (!milestones.some((m) => m.toLowerCase().includes(ln.toLowerCase().split(" ")[0]!))) {
        milestones.push(ln);
      }
    }
  }

  // If any keywords exist and template seems generic, inject keywords into milestones
  if (keywords.length > 0 && profile.type === "unknown") {
    const topKeyword = keywords[0]!.charAt(0).toUpperCase() + keywords[0]!.slice(1);
    milestones = milestones.map((m) =>
      m === "Core Implementation" ? `${topKeyword} ${m}` : m,
    );
  }

  // Trim/pad to est_milestones
  if (milestones.length > profile.est_milestones) {
    milestones = milestones.slice(0, profile.est_milestones);
  } else {
    // Add numbered extensions if more are needed
    while (milestones.length < profile.est_milestones) {
      const idx = milestones.length;
      const extra = keywords[idx] ?? `Phase ${idx + 1}`;
      milestones.push(
        extra.charAt(0).toUpperCase() + extra.slice(1),
      );
    }
  }

  return milestones;
}

// ─── Helper: generate features per milestone ────────────────────────────────

interface FeatureDef {
  name: string;
  priority: string;
  milestoneId: number;
}

function generateFeatures(
  description: string,
  profile: ProjectProfile,
  milestoneIds: number[],
): FeatureDef[] {
  const template = BUILD_TEMPLATES[profile.type] ?? BUILD_TEMPLATES["unknown"]!;
  const keywords = extractKeywords(description);
  const features: FeatureDef[] = [];

  for (let mi = 0; mi < milestoneIds.length; mi++) {
    const templateFeatures = template.featuresPerMilestone[mi] ?? [];
    let milestoneFeatures: string[];

    if (templateFeatures.length > 0) {
      // Use template features, optionally injecting keywords
      milestoneFeatures = templateFeatures.map((f) => {
        if (keywords.length > 0 && f.startsWith("Implement") || f.startsWith("Build")) {
          const kw = keywords[mi % keywords.length] ?? keywords[0]!;
          const keywordLabel = kw.charAt(0).toUpperCase() + kw.slice(1);
          return `${f} (${keywordLabel})`;
        }
        return f;
      });
    } else {
      // Dynamic generation for phases beyond template
      const phaseLabel = keywords[mi] ?? `Phase ${mi + 1}`;
      milestoneFeatures = [
        `${phaseLabel.charAt(0).toUpperCase() + phaseLabel.slice(1)} core logic`,
        `${phaseLabel.charAt(0).toUpperCase() + phaseLabel.slice(1)} integration`,
      ];
    }

    // Limit features per milestone based on complexity
    const maxPerMilestone = profile.complexity === "complex" ? 3 : profile.complexity === "simple" ? 1 : 2;
    const selectedFeatures = milestoneFeatures.slice(0, maxPerMilestone);

    for (const f of selectedFeatures) {
      features.push({
        name: f,
        priority: mi === 0 ? "high" : mi < 3 ? "medium" : "low",
        milestoneId: milestoneIds[mi]!,
      });
    }
  }

  return features;
}

// ─── Helper: generate swarm tasks from milestones/features ──────────────────

interface SwarmTaskDef {
  name: string;
  layerNum: number;
  routingCode: number;
  depTaskIndices: number[]; // indices into the tasks array for dependency resolution
}

const LAYER_TASK_TEMPLATES: Record<string, string[]> = {
  "Plan & Scaffold": ["Architecture design", "Project scaffolding"],
  "Core Features": ["Feature implementation", "Integration"],
  "Polish & Ship": ["Testing", "Documentation & deploy"],
  "Data Model & Routes": ["Schema design", "Route implementation"],
  "Tests & Docs": ["Test suite", "Documentation"],
  "Commands & Flags": ["CLI argument parsing", "Command routing"],
  "Build & Distribute": ["Build pipeline", "Distribution setup"],
  "Extension Shell": ["Manifest & popup", "Background script"],
  "Features & Permissions": ["Content scripts", "Permissions config"],
  "Setup & Navigation": ["Project init", "Navigation setup"],
  "Core Screens": ["Main screen components", "Screen logic"],
  "Polish & Ship": ["UI polish", "Ship preparation"],
  "Ingest & Transform": ["Data ingestion", "Data transformation"],
  "Validate & Monitor": ["Data validation", "Monitoring setup"],
  "API Design": ["Interface definition", "Type exports"],
  "Tests & Publish": ["Test suite", "Publish pipeline"],
  "Data + Charts": ["Data fetching", "Chart rendering"],
  "Layout + Polish": ["Dashboard layout", "Responsive design"],
  "Automation Logic": ["Core automation", "Error handling"],
  "Data Pipeline": ["Data collection", "Preprocessing"],
  "Model Training": ["Model architecture", "Training pipeline"],
  "Serving & API": ["Serving endpoint", "API integration"],
  "Core Mechanics": ["Game loop", "Physics system"],
  "Content & Levels": ["Level design", "Game objects"],
  "UI & Audio": ["UI overlays", "Audio system"],
  "Design & Plan": ["Requirements analysis", "Architecture design"],
  "Design & Plan": ["Architecture design", "Project setup"],
  "Core Implementation": ["Core logic", "Primary features"],
};

function generateSwarmTasks(
  features: FeatureDef[],
  milestoneIds: number[],
  profile: ProjectProfile,
): SwarmTaskDef[] {
  const tasks: SwarmTaskDef[] = [];
  const layerNames = profile.layer_names;
  const featureLayerMap = new Map<number, string[]>(); // milestoneIndex -> layer names

  // Distribute layers across milestones
  for (let mi = 0; mi < milestoneIds.length; mi++) {
    const layerIdx = Math.min(mi, layerNames.length - 1);
    const assignedLayers = mi === 0
      ? [layerNames[0]!]
      : mi >= milestoneIds.length - 1
        ? [layerNames[layerNames.length - 1]!]
        : layerNames.length > 1
          ? [layerNames[Math.min(mi, layerNames.length - 1)]!]
          : [layerNames[0]!];
    featureLayerMap.set(mi, assignedLayers);
  }

  // Build task list
  for (let fi = 0; fi < features.length; fi++) {
    const f = features[fi]!;
    const mi = milestoneIds.indexOf(f.milestoneId);
    const layers = featureLayerMap.get(mi) ?? [layerNames[0] ?? "Core"];

    for (const layer of layers) {
      const templates = LAYER_TASK_TEMPLATES[layer] ?? ["Implementation", "Verification"];
      const selectedTemplate = templates[fi % templates.length]!;

      tasks.push({
        name: `${selectedTemplate}: ${f.name}`,
        layerNum: layerNames.indexOf(layer),
        routingCode: profile.routing_code,
        // Tasks depend on previous milestone's last task
        depTaskIndices: mi > 0 && tasks.length > 0
          ? [tasks.length - 1]
          : [],
      });
    }
  }

  // If no tasks generated, create at least one per milestone
  if (tasks.length === 0) {
    for (let mi = 0; mi < milestoneIds.length; mi++) {
      tasks.push({
        name: `Implement milestone ${mi + 1}`,
        layerNum: Math.min(mi, layerNames.length - 1),
        routingCode: profile.routing_code,
        depTaskIndices: mi > 0 ? [mi - 1] : [],
      });
    }
  }

  return tasks;
}

// ─── Main command ───────────────────────────────────────────────────────────

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {
  "build": async (db, args) => {
    const description = args.join(" ");
    if (!description) {
      console.log("");
      console.log(`  ${badge("Usage:", "dim")} pmm-ai build <description>`);
      console.log(`  ${badge("Example:", "dim")} pmm-ai build "a workout tracking app with social features"`);
      console.log("");
      return;
    }

    // ═══ 1. Auto-derive profile ═════════════════════════════════════════
    const profile = derive(description);

    // ═══ 2. Derive project name & register ══════════════════════════════
    const projectName = deriveProjectName(description, profile);

    const existingId = getProjectId(db, projectName);
    if (existingId) {
      console.log("");
      console.log(`  ${badge("Project already registered:", "yellow")} ${projectName}`);
      console.log(`  ${badge("Deploy:", "dim")} pmm-ai swarm deploy ${projectName}`);
      console.log(`  ${badge("Visualize:", "dim")} pmm-ai swarm visualize ${projectName}`);
      console.log("");
      return;
    }

    const milestoneNames = generateMilestones(description, profile);

    // ── Register project ──
    const techStack = [profile.language];
    if (profile.framework) techStack.push(profile.framework);

    const phase = profile.complexity === "simple" ? "build" : "design";
    const priority = profile.complexity === "complex" ? "high" : profile.complexity === "simple" ? "low" : "medium";

    run(
      db,
      `INSERT INTO projects (name, status, phase, priority, health, tech_stack) VALUES (?, 'active', ?, ?, 'healthy', ?)`,
      [projectName, phase, priority, JSON.stringify(techStack)],
    );
    const projectId = (db.query("SELECT last_insert_rowid() AS id").get() as any).id;

    // ═══ 3. Generate milestones ═════════════════════════════════════════
    const milestoneIds: number[] = [];
    for (const mName of milestoneNames) {
      run(
        db,
        `INSERT INTO milestones (project_id, name, status) VALUES (?, ?, 'pending')`,
        [projectId, mName],
      );
      const row = db.query("SELECT last_insert_rowid() AS id").get() as any;
      milestoneIds.push(row.id);
    }

    // ═══ 4. Generate features ═══════════════════════════════════════════
    const features = generateFeatures(description, profile, milestoneIds);
    const featureIds: number[] = [];
    for (const f of features) {
      run(
        db,
        `INSERT INTO features (project_id, name, status, priority, epic_milestone_id) VALUES (?, ?, 'planned', ?, ?)`,
        [projectId, f.name, f.priority, f.milestoneId],
      );
      const row = db.query("SELECT last_insert_rowid() AS id").get() as any;
      featureIds.push(row.id);
    }

    // ═══ 5. Auto-configure swarm layers ═════════════════════════════════
    autoConfigureSwarm(db, projectId, profile);

    // ═══ 6. Register swarm tasks ════════════════════════════════════════
    const taskDefs = generateSwarmTasks(features, milestoneIds, profile);

    // Insert tasks in order. Dependencies reference indices, so we:
    // a) insert all tasks (first pass without dependencies)
    // b) update with resolved dependencies (second pass)
    const insertedTaskIds: number[] = [];
    for (const tDef of taskDefs) {
      run(
        db,
        `INSERT INTO swarm_tasks (project_id, layer_num, routing_code, name, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [projectId, tDef.layerNum, tDef.routingCode, tDef.name],
      );
      const row = db.query("SELECT last_insert_rowid() AS id").get() as any;
      insertedTaskIds.push(row.id);
    }

    // Second pass: set dependencies using inserted IDs
    for (let i = 0; i < taskDefs.length; i++) {
      const depIds = taskDefs[i]!.depTaskIndices
        .filter((idx) => idx >= 0 && idx < insertedTaskIds.length)
        .map((idx) => insertedTaskIds[idx]!);

      if (depIds.length > 0) {
        run(
          db,
          `UPDATE swarm_tasks SET dependencies = ? WHERE id = ?`,
          [JSON.stringify(depIds), insertedTaskIds[i]],
        );
      }
    }

    // ═══ 7. Summary dashboard ═══════════════════════════════════════════
    const totalTasks = taskDefs.length;
    const gateWarnings: string[] = [];

    const mGate = profile.est_milestones > profile.caps.max_milestones
      ? `Milestones: ${profile.est_milestones} exceeds cap of ${profile.caps.max_milestones}`
      : null;
    const fGate = features.length > profile.caps.max_features
      ? `Features: ${features.length} exceeds cap of ${profile.caps.max_features}`
      : null;
    if (mGate) gateWarnings.push(mGate);
    if (fGate) gateWarnings.push(fGate);

    console.log("");
    console.log(`  ${badge("═══════ Autonomous Build Complete ═══════", "blue")}`);
    divider();
    console.log(`  ${badge("Project:", "dim")}   ${projectName}`);
    console.log(`  ${badge("Type:", "dim")}      ${profile.type}  |  ${badge(profile.complexity, profile.complexity === "simple" ? "green" : profile.complexity === "complex" ? "red" : "yellow")}`);
    console.log(`  ${badge("Stack:", "dim")}     ${profile.language}${profile.framework ? ` + ${profile.framework}` : ""}`);
    console.log(`  ${badge("Routing:", "dim")}   code ${profile.routing_code}  |  ${profile.layer_count} agent layers`);
    console.log("");
    console.log(`  ${badge("Generated:", "dim")} ${milestoneIds.length} milestones · ${features.length} features · ${profile.layer_count} agent layers`);
    console.log(`  ${badge("Swarm:", "dim")}     ${totalTasks} tasks across ${profile.layer_names.join(", ")}`);
    console.log("");

    if (gateWarnings.length > 0) {
      console.log(`  ${badge("╔══ Scope Warnings ══╗", "yellow")}`);
      for (const w of gateWarnings) {
        console.log(`  ${badge("║", "yellow")}  ${w}`);
      }
      console.log(`  ${badge("╚════════════════════╝", "yellow")}`);
      console.log("");
    }

    console.log(`  ${badge("LAYERS", "blue")}`);
    for (let i = 0; i < profile.layer_count; i++) {
      const layerName = profile.layer_names[i] ?? `Layer ${i}`;
      const layerTaskCount = taskDefs.filter((t) => t.layerNum === i).length;
      console.log(`    L${i}: ${layerName}  (${layerTaskCount} tasks)`);
    }
    console.log("");

    console.log(`  ${badge("MILESTONES", "blue")}`);
    for (let i = 0; i < milestoneIds.length; i++) {
      const featCount = features.filter((f) => f.milestoneId === milestoneIds[i]!).length;
      console.log(`    M${i + 1}: ${milestoneNames[i]}  (${featCount} features)`);
    }
    console.log("");

    console.log(`  ${badge("FEATURES", "blue")}`);
    for (let i = 0; i < features.length; i++) {
      const f = features[i]!;
      const mi = milestoneIds.indexOf(f.milestoneId);
      const mName = milestoneNames[mi] ?? `M${mi + 1}`;
      console.log(`    F${i + 1}: ${f.name}  ${badge(`[${f.priority}]`, "dim")} ${badge(`→ ${mName}`, "dim")}`);
    }
    console.log("");

    // ── Ready banner ──
    console.log(`  ${badge("═══════ Ready ═══════", "green")}`);
    console.log(`  ${badge("Deploy:", "dim")}     pmm-ai swarm deploy ${projectName}`);
    console.log(`  ${badge("Visualize:", "dim")}  pmm-ai swarm visualize ${projectName}`);
    console.log(`  ${badge("Status:", "dim")}     pmm-ai swarm status ${projectName}`);
    console.log(`  ${badge("Export:", "dim")}     pmm-ai swarm export ${projectName} --format markdown`);
    console.log(`  ${badge("Pool:", "dim")}       pmm-ai swarm pool ${projectName}`);
    console.log("");
  },
};
