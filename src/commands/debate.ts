/**
 * PMM Debate Command — Scenario 2
 * ================================
 * A/B architectural debate engine that generates opposing positions,
 * synthesizes recommendations, and records decisions to the database.
 *
 * Usage: pmm-ai debate <question> [--project <name>]
 *
 * Keyword-based heuristics detect the topic category from the question:
 *   Database, Language, Framework, Architecture, State Management, CSS
 * Falls back to a generic architecture debate for unrecognized topics.
 *
 * Follows PMM module pattern: exports `commands` record with a "debate" handler.
 */

import type { Database } from "bun:sqlite";
import { queryAll, queryOne, run, getProjectId } from "../db";
import { badge, divider, confirm, prompt } from "./shared";

// ─── Types ──────────────────────────────────────────────────────────────

interface Position {
  name: string;
  pros: string[];
  cons: string[];
}

interface TopicTemplate {
  keywords: RegExp;
  category: string;
  positionA: Position;
  positionB: Position;
  recommendation: string;
}

// ─── Topic Templates ────────────────────────────────────────────────────

const TOPICS: TopicTemplate[] = [
  // ── Database ──────────────────────────────────────────────────────────
  {
    keywords: /sqlite|postgres(?:ql)?|mongo(?:db)?|database|rdbms|nosql|relational|data.?store|data.?layer/i,
    category: "Database",
    positionA: {
      name: "SQLite",
      pros: [
        "Zero ops overhead -- no server to manage or configure",
        "Single-file database -- trivial to back up and version-control",
        "No network latency -- embedded directly in the application process",
        "Excellent for single-user, local-first, and embedded use cases",
        "Batteries-included (JSON functions, FTS5, CTEs, window functions)",
      ],
      cons: [
        "Limited concurrent writes (WAL mode helps but is not a full solution)",
        "No horizontal scaling -- single-node architecture only",
        "No role-based access control or row-level security",
        "Less mature replication and high-availability story",
      ],
    },
    positionB: {
      name: "Postgres",
      pros: [
        "Proven at scale -- powers production workloads across all sizes",
        "Rich indexing (B-tree, GiST, GIN, BRIN, SP-GiST, Hash)",
        "Full-text search with custom dictionaries and ranking",
        "Concurrent writes with MVCC -- readers never block writers",
        "RBAC, row-level security, encryption at rest, extension ecosystem",
      ],
      cons: [
        "Operational overhead -- vacuum, connection pooling, replication setup",
        "Connection management typically requires PgBouncer or similar",
        "Hosting cost (RDS, Cloud SQL, Aurora, or self-hosted infrastructure)",
        "Heavier memory and CPU footprint for small workloads",
      ],
    },
    recommendation:
      "SQLite for MVP and local-first apps (zero ops, embedded). Plan migration to Postgres when concurrent write load exceeds 1K req/s or horizontal scale is needed. MongoDB is a strong alternative for document-shaped data with flexible schemas.",
  },

  // ── Language ──────────────────────────────────────────────────────────
  {
    keywords: /typescript|javascript|type.?safe|static.?type|dynamic.?type|typed|type.?system|language/i,
    category: "Language",
    positionA: {
      name: "TypeScript",
      pros: [
        "Static types catch entire classes of bugs at compile time",
        "Superior IDE experience -- autocomplete, refactoring, inline documentation",
        "Rich type system (generics, unions, conditional, template literal types)",
        "Same language for frontend and backend -- share types and logic",
        "DefinitelyTyped ecosystem covers virtually every JavaScript library",
      ],
      cons: [
        "Build step required (tsc, esbuild, or bundler) -- adds tooling complexity",
        "Type annotations add boilerplate for simple scripts and prototypes",
        "Learning curve for advanced type features (infer, satisfies, mapped types)",
        "Slower iteration speed during early prototyping phases",
      ],
    },
    positionB: {
      name: "JavaScript",
      pros: [
        "Fastest iteration -- zero config, zero build step, just run",
        "Dynamic nature makes prototyping incredibly fast and fluid",
        "Universal runtime -- browser, server, edge workers, IoT devices",
        "JSDoc provides lightweight type hints without a build step",
        "Works everywhere without transpilation or compatibility concerns",
      ],
      cons: [
        "Runtime surprises from dynamic typing -- unexpected undefined errors",
        "No IDE-level refactoring safety across a large codebase",
        "Harder to enforce contracts and interfaces in larger teams",
        "Linter rules mitigate but cannot fully eliminate type-related defects",
      ],
    },
    recommendation:
      "TypeScript for any project with more than one developer or a long maintenance horizon. JavaScript for quick prototypes, scripts, and solo projects where iteration speed is paramount. Python for data science or ML-heavy workloads.",
  },

  // ── Framework ─────────────────────────────────────────────────────────
  {
    keywords: /react|vue|svelte|framework|frontend|ui.?framework|component.?library|view.?layer/i,
    category: "Framework",
    positionA: {
      name: "React",
      pros: [
        "Largest ecosystem -- libraries, tools, tutorials, and community support",
        "Massive talent pool -- easiest hiring and community resources",
        "React Native enables cross-platform mobile from the same codebase",
        "Flexible architecture -- choose routing, state management, data-fetching",
        "Server Components and Server Actions for modern full-stack patterns",
      ],
      cons: [
        "Boilerplate and configuration overhead -- bundler, routing, state",
        "Re-render optimization requires manual effort (memo, useMemo, useCallback)",
        "JSX couples markup with logic -- polarizing for separation-of-concerns advocates",
        "Rapid ecosystem churn creates upgrade fatigue (CRA to Vite, classes to hooks)",
      ],
    },
    positionB: {
      name: "Vue",
      pros: [
        "Gentle learning curve -- approachable for beginners and experienced alike",
        "Single-file components keep template, script, and style co-located",
        "Built-in state management (ref, reactive) with no extra dependencies",
        "Excellent documentation with opinionated, consistent best practices",
        "Lightweight with fast performance out of the box and minimal config",
      ],
      cons: [
        "Smaller ecosystem and talent pool compared to the React ecosystem",
        "Mobile-native story is weaker (NativeScript/Vue vs React Native)",
        "Less prevalent outside of certain geographic markets",
        "Reactivity system can have edge cases with deeply nested objects",
      ],
    },
    recommendation:
      "React for maximum ecosystem reach, hiring pool, and full-stack apps. Vue for smaller teams who value approachability and built-in patterns. Svelte for highly reactive UIs with minimal runtime overhead.",
  },

  // ── Architecture ──────────────────────────────────────────────────────
  {
    keywords: /monolith|microservice|serverless|architecture|architectural|decomposition|service.?split|distributed|soa|modular/i,
    category: "Architecture",
    positionA: {
      name: "Monolith",
      pros: [
        "Simplest deployment -- one binary, one process, one server",
        "No network overhead between components -- in-process calls only",
        "Single codebase simplifies debugging and refactoring",
        "Transactional consistency without distributed coordination",
        "Lower infrastructure cost and operational complexity",
      ],
      cons: [
        "Scales vertically only -- eventually hits hardware limits",
        "Team coordination bottlenecks -- merge conflicts, coupling, release trains",
        "Technology lock-in -- hard to adopt new stacks for specific features",
        "Single failure domain -- one crash can cascade across the entire app",
      ],
    },
    positionB: {
      name: "Microservices",
      pros: [
        "Independent deployability -- each service ships on its own cadence",
        "Horizontal scaling -- scale only the services that need it",
        "Technology diversity -- choose the best tool for each bounded context",
        "Team autonomy -- small teams own the end-to-end service lifecycle",
        "Failure isolation -- a crash in one service is contained",
      ],
      cons: [
        "Distributed system complexity -- latency, partial failures, observability",
        "Operational overhead -- orchestration, service mesh, logging, tracing",
        "Data consistency challenges -- eventual consistency, sagas, two-phase commit",
        "Premature decomposition -- wrong boundaries are costly to reverse",
      ],
    },
    recommendation:
      "Start monolith -- validate product-market fit, discover natural domain boundaries. Extract services only when clear seams emerge. Microservices when team exceeds 12 people or independent deploy velocity is critical. Serverless for event-driven or spiky workloads.",
  },

  // ── State Management ──────────────────────────────────────────────────
  {
    keywords: /redux|zustand|context|state.?management|state.?container|store|flux|atomic.?state|state.?library/i,
    category: "State Management",
    positionA: {
      name: "Zustand",
      pros: [
        "Minimal API -- create a store, use it, done. No providers or actions.",
        "Zero boilerplate -- no reducers, dispatchers, or action creators",
        "Tiny bundle (~1 KB) compared to Redux (~12 KB plus middleware)",
        "Framework-agnostic -- works with React, Vue, Svelte, or vanilla JS",
        "First-class TypeScript support with excellent type inference",
      ],
      cons: [
        "No DevTools ecosystem comparable to Redux DevTools",
        "No middleware abstraction -- side effects managed manually",
        "Fewer established patterns for large-scale state orchestration",
        "Smaller community -- fewer resources, recipes, and examples",
      ],
    },
    positionB: {
      name: "Redux",
      pros: [
        "Predictable state with single store, pure reducers, unidirectional flow",
        "Excellent DevTools -- time-travel debugging, action replay, state diffing",
        "Middleware ecosystem (thunks, sagas, observables) for complex workflows",
        "Redux Toolkit dramatically reduces boilerplate (createSlice, RTK Query)",
        "Widely understood -- the de facto standard for large React applications",
      ],
      cons: [
        "Boilerplate legacy persists despite RTK -- actions, reducers, selectors",
        "Conceptual overhead -- dispatch, reducers, immutability, middleware chain",
        "Overkill for simple CRUD or components with purely local state",
        "Typing is verbose -- union action types, payload interfaces, selector inference",
      ],
    },
    recommendation:
      "Zustand for new projects -- simpler API, smaller bundle, sufficient for 95% of needs. Redux when you need DevTools, middleware-heavy flows, or inherit a Redux codebase. React Context for truly global, infrequently-changing state (theme, auth, locale).",
  },

  // ── CSS Approach ──────────────────────────────────────────────────────
  {
    keywords: /tailwind|css.?modules?|styled.?component|css.?in.?js|styling|utility.?class|css.?framework|design.?system/i,
    category: "CSS Approach",
    positionA: {
      name: "Tailwind CSS",
      pros: [
        "Rapid iteration -- compose UIs from utility classes, no file switching",
        "Zero runtime -- purges unused CSS, ships only what is used in production",
        "Enforced design tokens -- consistent spacing, colors, typography everywhere",
        "Responsive design built-in with breakpoint prefix utilities (sm:, md:, lg:)",
        "Vibrant ecosystem -- component libraries, plugins, Figma-to-Tailwind tools",
      ],
      cons: [
        "Long class strings can clutter HTML (mitigated by @apply directive)",
        "Learning curve to memorize utility class names and variant patterns",
        "Non-standard CSS -- couples to a framework-specific naming convention",
        "Class names describe presentation rather than semantic content",
      ],
    },
    positionB: {
      name: "CSS Modules",
      pros: [
        "Standard CSS -- no framework lock-in, uses native CSS features",
        "Automatic scoping -- class names are hashed, zero collision risk",
        "Composable via :composes -- share styles without duplicating classes",
        "Zero runtime -- styles are extracted at build time, no JS overhead",
        "Works with any framework -- React, Vue, Svelte, or vanilla JS",
      ],
      cons: [
        "No design token enforcement -- teams must self-enforce consistency",
        "No built-in responsive utilities -- each media query written manually",
        "Abstraction overhead -- decisions per component on class structure",
        "No automatic purging -- unused CSS accumulates without extra tooling",
      ],
    },
    recommendation:
      "Tailwind CSS for most projects -- faster iteration and design consistency. CSS Modules when you prefer standard CSS patterns or are migrating an existing styled system. Styled-components for dynamic runtime styles tightly coupled to component logic.",
  },
];

// ─── Fallback Topic ─────────────────────────────────────────────────────

function generateFallbackTopic(): TopicTemplate {
  return {
    keywords: /.*/,
    category: "General Architecture",
    positionA: {
      name: "Option A -- Conservative Approach",
      pros: [
        "Leverages proven, battle-tested patterns and technologies",
        "Lower risk profile -- fewer unknowns and edge cases",
        "Team likely has existing expertise and operational familiarity",
        "Easier to estimate timelines and resource requirements",
      ],
      cons: [
        "May miss opportunities for step-change improvements",
        "Could over-engineer for current scale or requirements",
        "Might be slower to iterate on core differentiators",
      ],
    },
    positionB: {
      name: "Option B -- Forward-Looking Approach",
      pros: [
        "Adopts modern patterns that reduce future migration cost",
        "Differentiates the product with better developer or user experience",
        "Attracts talent interested in working with cutting-edge technology",
      ],
      cons: [
        "Higher risk -- newer tools have fewer battle scars",
        "Team learning curve -- slower initial velocity",
        "Ecosystem maturity risk -- docs, tooling, and packages still evolving",
      ],
    },
    recommendation:
      "Evaluate based on team size, timeline pressure, and risk tolerance. Conservative for critical-path production systems; forward-looking for greenfield projects with experienced teams. Consider a spike or prototype to validate assumptions before committing.",
  };
}

// ─── Project Detection ──────────────────────────────────────────────────

/** Attempt to auto-detect current project from CWD via repo_path or directory name match. */
function detectProjectFromCWD(db: Database): string | null {
  const cwd = process.cwd();
  const projects = queryAll(db, "SELECT name, repo_path FROM projects WHERE status = 'active'");
  for (const p of projects) {
    if (p.repo_path && cwd.startsWith(p.repo_path)) {
      return p.name;
    }
  }
  // Fallback: try matching the current directory name as a project name
  const dirName = cwd.split(/[/\\]/).pop() || "";
  if (dirName) {
    const exact = queryOne(db, "SELECT name FROM projects WHERE name = ?", [dirName]) as any;
    if (exact) return exact.name;
  }
  return null;
}

/** Detect which topic template best matches the user question. Returns null for fallback. */
function detectTopic(question: string): TopicTemplate | null {
  for (const topic of TOPICS) {
    if (topic.keywords.test(question)) return topic;
  }
  return null;
}

// ─── Display Helpers ────────────────────────────────────────────────────

function showPosition(label: string, pos: Position): void {
  console.log(`  ${label}:`);
  console.log(`    ${badge("Pros:", "green")}`);
  for (const p of pos.pros) {
    console.log(`      \x1b[32m+\x1b[0m  ${p}`);
  }
  console.log(`    ${badge("Cons:", "red")}`);
  for (const c of pos.cons) {
    console.log(`      \x1b[31m\u2212\x1b[0m  ${c}`);
  }
  console.log("");
}

function buildRationale(question: string, topic: TopicTemplate): string {
  const lines = [
    `--- Generated by PMM Debate ---`,
    `Question: ${question}`,
    `Category: ${topic.category}`,
    "",
    `Position A -- ${topic.positionA.name}:`,
    ...topic.positionA.pros.map((p) => `  + ${p}`),
    ...topic.positionA.cons.map((c) => `  - ${c}`),
    "",
    `Position B -- ${topic.positionB.name}:`,
    ...topic.positionB.pros.map((p) => `  + ${p}`),
    ...topic.positionB.cons.map((c) => `  - ${c}`),
    "",
    `Recommendation: ${topic.recommendation}`,
  ];
  return lines.join("\n");
}

// ─── Command Handler ────────────────────────────────────────────────────

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {
  debate: async (db, args) => {
    let projectName: string | null = null;
    const filteredArgs: string[] = [];

    // Parse --project flag
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) {
        projectName = args[++i]!;
      } else {
        filteredArgs.push(args[i]!);
      }
    }

    const question = filteredArgs.join(" ");
    if (!question) {
      console.log("");
      console.log("  Usage: pmm-ai debate <question> [--project <name>]");
      console.log("");
      console.log("  Examples:");
      console.log('    pmm-ai debate "SQLite vs Postgres for workout-tracker"');
      console.log('    pmm-ai debate "React or Vue for a dashboard app" --project my-app');
      console.log("");
      return;
    }

    // Detect topic, falling back to generic architecture debate
    const topic = detectTopic(question) ?? generateFallbackTopic();

    // Auto-detect project from CWD if not explicitly provided
    if (!projectName) {
      projectName = detectProjectFromCWD(db);
    }

    // Display debate
    console.log("");
    divider(badge("PMM Debate", "blue"));
    console.log(`  ${badge("Question:", "blue")} ${question}`);
    if (projectName) {
      console.log(`  ${badge("Project:", "dim")} ${projectName}`);
    }
    console.log("");

    showPosition(`${badge("Position A", "green")} \u2014 ${topic.positionA.name}`, topic.positionA);
    showPosition(`${badge("Position B", "yellow")} \u2014 ${topic.positionB.name}`, topic.positionB);

    console.log(`  ${badge("Recommendation:", "blue")}`);
    console.log(`    ${topic.recommendation}`);
    console.log("");

    // Record decision
    const decisionText = `${topic.positionA.name} vs ${topic.positionB.name}`;
    const rationale = buildRationale(question, topic);

    if (projectName) {
      // Project explicitly provided or auto-detected => auto-record
      const pid = getProjectId(db, projectName);
      if (pid) {
        // Check for existing decision with the same question for this project
        const existing = queryOne(
          db,
          "SELECT id FROM decisions WHERE project_id = ? AND question = ?",
          [pid, question],
        ) as any;
        if (existing) {
          run(
            db,
            "UPDATE decisions SET decision = ?, rationale = ?, status = 'decided' WHERE id = ?",
            [decisionText, rationale, existing.id],
          );
          console.log(`  ${badge("Updated", "green")} decision #${existing.id} for project "${projectName}".`);
        } else {
          run(
            db,
            "INSERT INTO decisions (project_id, question, decision, rationale, status) VALUES (?, ?, ?, ?, 'decided')",
            [pid, question, decisionText, rationale],
          );
          console.log(`  ${badge("Decided", "green")} Recorded as decision for "${projectName}".`);
        }
      } else {
        console.log(`  ${badge("Skip", "yellow")} Project "${projectName}" not found in database.`);
        console.log(`    Register it with: pmm-ai project register ${projectName}`);
      }
    } else {
      // No project detected -- ask user before recording
      const shouldRecord = await confirm("  Record this decision?");
      if (shouldRecord) {
        const manualProject = await prompt("  Enter project name");
        if (manualProject) {
          const pid = getProjectId(db, manualProject);
          if (pid) {
            run(
              db,
              "INSERT INTO decisions (project_id, question, decision, rationale, status) VALUES (?, ?, ?, ?, 'decided')",
              [pid, question, decisionText, rationale],
            );
            console.log(`  ${badge("Decided", "green")} Recorded as decision for "${manualProject}".`);
          } else {
            console.log(`  ${badge("Skip", "yellow")} Project "${manualProject}" not found in database.`);
          }
        } else {
          console.log(`  ${badge("Skip", "dim")} No project entered. Not recorded.`);
        }
      } else {
        console.log(`  ${badge("Skip", "dim")} Not recorded.`);
      }
    }

    console.log("");
    divider();
    console.log("");
  },
};
