/**
 * PMM-AI Debate — Scenario 2
 * ===========================
 * A/B architectural debate with automatic decision recording.
 *
 * Usage:
 *   pmm-ai debate <question>
 *   pmm-ai debate <question> --project <name>
 */
import type { Database } from "bun:sqlite";
import { queryOne, run, getProjectId, getProjectIdOrFail } from "../db";
import { badge, divider } from "./shared";

type Position = { label: string; pros: string[]; cons: string[] };

const DEBATE_KNOWLEDGE: Record<string, { a: Position; b: Position; recommendation: string }> = {
  database: {
    a: { label: "SQLite", pros: ["Zero ops — single file, no server", "Perfect for single-user / mobile", "No network latency", "Great for prototyping"], cons: ["Limited concurrent writes", "No horizontal scaling", "Not suited for high-traffic APIs"] },
    b: { label: "PostgreSQL", pros: ["Proven at massive scale", "Rich indexing + full-text search", "Concurrent write support", "Ecosystem: ORMs, tools, hosting"], cons: ["Ops overhead (backups, tuning)", "Connection management complexity", "~$15-30/mo hosting minimum"] },
    recommendation: "SQLite for MVP and <1000 users. PostgreSQL migration path at scale."
  },
  language: {
    a: { label: "TypeScript", pros: ["Type safety catches bugs early", "Excellent IDE support", "Huge ecosystem (npm)", "Same language front+back"], cons: ["Build step required", "Type complexity can slow prototyping", "Config overhead (tsconfig)"] },
    b: { label: "Python", pros: ["Fastest to prototype", "Readable, concise syntax", "Best ML/AI ecosystem", "Great for scripts/automation"], cons: ["No compile-time type checking", "Slower runtime than compiled", "GIL limits concurrency", "Package management can be messy"] },
    recommendation: "TypeScript for production apps, Python for scripts/ML/data."
  },
  framework: {
    a: { label: "React", pros: ["Largest ecosystem + community", "Job market standard", "Next.js for full-stack", "Rich component libraries"], cons: ["Heavy bundle size", "Complex hooks mental model", "Frequent API churn", "Boilerplate for simple things"] },
    b: { label: "Vue/Svelte", pros: ["Lighter weight, faster", "Simpler mental model", "Less boilerplate", "Great for smaller teams"], cons: ["Smaller ecosystem", "Fewer job opportunities", "Less third-party library support"] },
    recommendation: "React for large teams / career growth. Vue/Svelte for smaller, fast-moving teams."
  },
  architecture: {
    a: { label: "Monolith", pros: ["Simple to develop and deploy", "One codebase to understand", "Easy to test end-to-end", "Fast initial development"], cons: ["Hard to scale team >10 devs", "Release coupling", "Technology lock-in", "Hard to isolate failures"] },
    b: { label: "Microservices", pros: ["Independent deploy and scale", "Team autonomy", "Technology diversity", "Fault isolation"], cons: ["Operational complexity (k8s, service mesh)", "Network latency and failures", "Data consistency challenges", "Overhead for small teams"] },
    recommendation: "Start with well-structured monolith. Extract services when team >10 or scaling demands it."
  },
  state: {
    a: { label: "Redux/Zustand", pros: ["Predictable state management", "Excellent devtools", "Time-travel debugging", "Middleware ecosystem"], cons: ["Boilerplate (Redux)", "Overkill for simple apps", "Learning curve", "Can add complexity without benefit"] },
    b: { label: "React Context + hooks", pros: ["Built-in — no extra deps", "Simple mental model", "Enough for most apps", "No boilerplate"], cons: ["Performance at scale (re-renders)", "No middleware/devtools", "Can get messy with many contexts", "No time-travel debugging"] },
    recommendation: "Context + hooks for simple apps. Zustand for medium complexity. Redux only for large enterprise apps."
  },
  css: {
    a: { label: "Tailwind CSS", pros: ["Rapid prototyping", "No naming conventions needed", "Built-in responsive design", "Small production bundles"], cons: ["HTML gets cluttered", "Learning curve for utility classes", "Not standard CSS", "Hard to extract shared styles"] },
    b: { label: "CSS Modules / styled", pros: ["Standard CSS syntax", "Scoped by default", "Full CSS feature access", "Co-located with components"], cons: ["Naming within modules still needed", "Less rapid than Tailwind", "Bundle size can be larger", "Harder responsive patterns"] },
    recommendation: "Tailwind for rapid prototyping and small teams. CSS Modules for teams that prefer standard CSS."
  },
};

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {
  "debate": async (db, args) => {
    // Parse args: <question> [--project <name>]
    let projectName: string | null = null;
    const questionParts: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) {
        projectName = args[++i]!;
      } else {
        questionParts.push(args[i]!);
      }
    }
    const question = questionParts.join(" ");
    if (!question) {
      console.log("");
      console.log("  " + badge("Usage", "dim") + " pmm-ai debate <question> [--project <name>]");
      console.log("  " + badge("Example", "dim") + " pmm-ai debate \"SQLite or Postgres for my app?\"");
      console.log("");
      return;
    }

    // Auto-detect topic
    const topic = detectTopic(question);
    const knowledge = DEBATE_KNOWLEDGE[topic];

    console.log("");
    divider("PMM Debate", 52);
    console.log("");
    console.log("  " + badge("Question", "blue") + "  " + question);
    console.log("");

    if (knowledge) {
      console.log("  " + badge("Position A — " + knowledge.a.label, "green"));
      console.log("  " + "─".repeat(48));
      for (const p of knowledge.a.pros) console.log("    \x1b[32m+\x1b[0m " + p);
      for (const c of knowledge.a.cons) console.log("    \x1b[33m-\x1b[0m " + c);
      console.log("");

      console.log("  " + badge("Position B — " + knowledge.b.label, "yellow"));
      console.log("  " + "─".repeat(48));
      for (const p of knowledge.b.pros) console.log("    \x1b[32m+\x1b[0m " + p);
      for (const c of knowledge.b.cons) console.log("    \x1b[33m-\x1b[0m " + c);
      console.log("");

      console.log("  " + badge("Recommendation", "blue"));
      console.log("  " + knowledge.recommendation);
      console.log("");

      // Record decision if project provided or detectable
      const pid = projectName ? getProjectId(db, projectName) : null;
      if (pid) {
        run(db,
          "INSERT INTO decisions (project_id, question, decision, rationale, status) VALUES (?, ?, ?, ?, 'decided')",
          [pid, question, knowledge.recommendation, "Generated by pmm-ai debate — A/B analysis of " + topic]);
        console.log("  " + badge("✓ Recorded", "green") + " Decision saved to " + projectName);
      } else {
        console.log("  " + badge("Tip", "dim") + " Add --project <name> to auto-record this decision.");
      }
    } else {
      // No knowledge match — generic output
      console.log("  " + badge("Position A", "green"));
      console.log("  No predefined analysis for this topic. Consider:");
      console.log("    • Research both options independently");
      console.log("    • Compare: complexity, ecosystem, performance, team familiarity");
      console.log("    • Record as a decision: pmm-ai decision add <project> \"" + question + "\"");
      console.log("");
      console.log("  " + badge("Supported topics", "dim") + " database, language, framework, architecture, state, css");
    }

    console.log("");
  },
};

function detectTopic(question: string): string {
  const lower = question.toLowerCase();
  if (lower.match(/sqlite|postgres|mysql|mongo|database|db|supabase|firebase|dynamodb/)) return "database";
  if (lower.match(/typescript|javascript|python|golang?|rust|java\b|kotlin|swift|language|lang/)) return "language";
  if (lower.match(/react|vue|svelte|angular|next|nuxt|remix|framework|frontend/)) return "framework";
  if (lower.match(/monolith|microservice|serverless|architecture|arch\b|design\b/)) return "architecture";
  if (lower.match(/redux|zustand|mobx|recoil|context|state|store/)) return "state";
  if (lower.match(/tailwind|css|style|sass|less|styled|emotion/)) return "css";
  return "unknown";
}
