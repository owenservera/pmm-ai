/**
 * PMM-AI Tooling Commands — Dev Toolchain for the Platform
 * ========================================================
 * Exposes tree-shaking, linting, profiling, token budgeting,
 * dependency graphing, and garbage collection as CLI commands.
 *
 * Usage:
 *   pmm tooling lint          — Self-audit (skills, agents, hooks, MCP consistency)
 *   pmm tooling tree-shake    — Dead module detection
 *   pmm tooling tokens        — Token budget / bundle analyzer
 *   pmm tooling profile       — Agent profiler (latency, bottlenecks)
 *   pmm tooling deps          — Cross-project dependency graph
 *   pmm tooling cleanup       — Orphan detection + GC
 *   pmm tooling all           — Run all checks
 */
import type { Database } from "bun:sqlite";
import { badge, divider } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "tooling:lint": async (db, _args) => {
    const { lint } = await import("../tooling/self-lint");
    const result = lint(db);
    console.log("");
    divider("Self-Audit Lint", 60);
    console.log("");
    for (const c of result.checks) {
      const icon = c.passed ? badge("✓", "green") : c.critical ? badge("✗", "red") : badge("⚠", "yellow");
      const detail = c.issue ? " — " + c.issue : "";
      console.log("  " + icon + " " + c.name + detail);
    }
    console.log("");
    const pct = result.checks.length > 0 ? Math.round((result.passed / result.checks.length) * 100) : 100;
    const color = result.critical > 0 ? "red" : result.failed > 0 ? "yellow" : "green";
    console.log("  " + badge(result.passed + "/" + result.checks.length + " passed (" + pct + "%)", color));
    if (result.critical > 0) console.log("  " + badge(result.critical + " critical issues need attention", "red"));
    console.log("");
  },

  "tooling:tree-shake": async (db, _args) => {
    const { analyze } = await import("../tooling/tree-shake");
    const result = analyze(db);
    console.log("");
    divider("Tree Shake — Dead Code Detection", 60);
    console.log("");
    if (result.total_dead === 0) {
      console.log("  " + badge("✓ No dead code detected", "green"));
    } else {
      if (result.unresolved_commands.length > 0) {
        console.log("  " + badge("Unresolved Commands", "red"));
        for (const c of result.unresolved_commands) console.log("    ✗ " + c);
      }
      if (result.orphan_skills.length > 0) {
        console.log("  " + badge("Orphan Skills", "yellow"));
        for (const s of result.orphan_skills) console.log("    ○ " + s + " (no matching agent .md file)");
      }
      if (result.orphan_agents.length > 0) {
        console.log("  " + badge("Orphan Agents", "yellow"));
        for (const a of result.orphan_agents) console.log("    ○ " + a + " (not registered in PMM DB)");
      }
      if (result.unused_mcp_tools.length > 0) {
        console.log("  " + badge("Unused MCP Tools", "yellow"));
        for (const t of result.unused_mcp_tools) console.log("    ○ " + t);
      }
      if (result.dead_modules.length > 0) {
        console.log("  " + badge("Dead Modules", "dim"));
        for (const m of result.dead_modules.slice(0, 10)) console.log("    · " + m);
        if (result.dead_modules.length > 10) console.log("    ... and " + (result.dead_modules.length - 10) + " more");
      }
    }
    console.log("");
    console.log("  Total dead items: " + result.total_dead);
    console.log("");
  },

  "tooling:tokens": async (db, args) => {
    const { analyze } = await import("../tooling/token-budget");
    const projectName = args[0] || undefined;
    const result = analyze(db, projectName);
    console.log("");
    divider("Token Budget Tracker", 60);
    console.log("");
    console.log("  " + badge("Budget Summary", "blue"));
    console.log("  Total workers:   " + result.overall.total_workers);
    console.log("  Total tokens:    " + result.overall.total_tokens.toLocaleString());
    console.log("  Avg/worker:      " + result.overall.avg_tokens_per_worker.toLocaleString());
    console.log("  Est. cost:       $" + result.overall.total_cost_estimate.toFixed(2));
    console.log("");

    if (result.by_agent_type.length > 0) {
      console.log("  " + badge("By Agent Type", "dim"));
      for (const a of result.by_agent_type.slice(0, 5)) {
        console.log("    " + a.agent_type.padEnd(20) + " " + a.total_tokens.toLocaleString().padStart(10) + " tokens  (" + a.workers + " workers, avg " + a.avg_tokens.toLocaleString() + ")");
      }
    }
    console.log("");

    if (result.by_model.length > 0) {
      console.log("  " + badge("By Model", "dim"));
      for (const m of result.by_model.slice(0, 3)) {
        console.log("    " + m.model.padEnd(20) + " " + m.total_tokens.toLocaleString().padStart(10) + " tokens  (" + m.workers + " workers)");
      }
    }
    console.log("");

    if (result.alerts.length > 0) {
      console.log("  " + badge("Alerts", "yellow"));
      for (const a of result.alerts) console.log("    ⚠ " + a);
      console.log("");
    }

    if (result.top_expensive_workers.length > 0) {
      console.log("  " + badge("Most Expensive Workers", "dim"));
      for (const w of result.top_expensive_workers.slice(0, 5)) {
        console.log("    #" + w.id + " " + w.agent_type + " → " + w.project + ": " + w.tokens.toLocaleString() + " tokens ($" + (w.cost ?? 0).toFixed(2) + ")");
      }
      console.log("");
    }
  },

  "tooling:profile": async (db, args) => {
    const { analyze } = await import("../tooling/profiler");
    const projectName = args[0] || undefined;
    const result = analyze(db, projectName);
    console.log("");
    divider("Agent Profiler", 60);
    console.log("");

    console.log("  " + badge("Latency by Agent Type", "blue"));
    for (const a of result.latency.by_agent_type.slice(0, 5)) {
      const icon = a.avg_seconds > 600 ? badge("⚠", "yellow") : a.avg_seconds > 60 ? badge("○", "dim") : badge("✓", "green");
      console.log("  " + icon + " " + a.agent_type.padEnd(18) + " avg " + String(a.avg_seconds).padStart(7) + "s  (" + a.count + " workers)");
    }
    console.log("");

    console.log("  " + badge("Bottlenecks", "blue"));
    console.log("  Stuck workers:   " + result.bottlenecks.stuck_workers);
    console.log("  Failed workers:  " + result.bottlenecks.failed_workers);
    console.log("  Retried workers: " + result.bottlenecks.retried_workers);
    console.log("  Orphan workers:  " + result.bottlenecks.orphan_workers);
    console.log("");

    if (result.latency.slowest_workers.length > 0) {
      console.log("  " + badge("Slowest Workers", "dim"));
      for (const w of result.latency.slowest_workers.slice(0, 5)) {
        console.log("    #" + w.id + " " + w.agent_type + " → " + w.project + ": " + w.hours.toFixed(1) + "hr [" + w.status + "]");
      }
      console.log("");
    }

    if (result.recommendations.length > 0) {
      console.log("  " + badge("Recommendations", "yellow"));
      for (const r of result.recommendations) console.log("    → " + r);
      console.log("");
    }
  },

  "tooling:deps": async (db, _args) => {
    const { build } = await import("../tooling/dep-graph");
    const graph = build(db);
    console.log("");
    divider("Cross-Project Dependency Graph", 60);
    console.log("");

    console.log("  Nodes: " + graph.nodes.length + " | Edges: " + graph.edges.length);
    if (graph.circular_deps.length > 0) {
      console.log("  " + badge("Circular Dependencies", "red"));
      for (const cycle of graph.circular_deps) {
        console.log("    ↻ " + cycle.join(" → "));
      }
    }
    console.log("");

    if (graph.most_depended_on.length > 0) {
      console.log("  " + badge("Most Depended On", "blue"));
      for (const m of graph.most_depended_on) {
        console.log("    " + m.name.padEnd(30) + m.count + " dependents");
      }
    }
    console.log("");

    if (graph.orphans.length > 0) {
      console.log("  " + badge("Orphan Projects (no deps)", "dim"));
      for (const o of graph.orphans.slice(0, 8)) {
        console.log("    ○ " + o.name);
      }
      if (graph.orphans.length > 8) console.log("    ... and " + (graph.orphans.length - 8) + " more");
      console.log("");
    }
  },

  "tooling:cleanup": async (db, args) => {
    const { scan } = await import("../tooling/cleanup");
    const autoFix = args.includes("--fix");
    const result = scan(db, autoFix);
    console.log("");
    divider("Orphan Cleanup" + (autoFix ? " (--fix)" : ""), 60);
    console.log("");

    if (result.total_orphans === 0) {
      console.log("  " + badge("✓ Clean — no orphans found", "green"));
    } else {
      if (result.orphan_projects.length > 0) {
        console.log("  " + badge(result.orphan_projects.length + " orphan projects", "yellow"));
        for (const p of result.orphan_projects.slice(0, 5)) {
          console.log("    ○ " + p.name + " (last: " + (p.last_activity ?? "never") + ")");
        }
      }
      if (result.stuck_workers.length > 0) {
        console.log("  " + badge(result.stuck_workers.length + " stuck workers", "red"));
        for (const w of result.stuck_workers.slice(0, 3)) {
          console.log("    ✗ #" + w.id + " " + w.agent_type + " (" + w.hours_stale.toFixed(1) + "hr stale)");
        }
      }
      if (result.stale_sessions.length > 0) {
        console.log("  " + badge(result.stale_sessions.length + " stale sessions", "yellow"));
      }
    }
    console.log("");
    for (const r of result.recommendations) console.log("  " + r);
    console.log("");
  },

  "tooling:all": async (db, _args) => {
    // Run all tooling checks in sequence
    console.log("");
    console.log("  " + badge("◆ PMM-AI Platform Tooling — Full Scan", "blue"));
    console.log("");

    // Lint
    const { lint } = await import("../tooling/self-lint");
    const lintResult = lint(db);
    const passed = lintResult.passed;
    const total = lintResult.checks.length;
    const lintColor = lintResult.critical > 0 ? "red" : lintResult.failed > 0 ? "yellow" : "green";
    console.log("  " + badge("lint", "dim") + "       " + badge(passed + "/" + total, lintColor) + "  (" + lintResult.critical + " critical)");

    // Tree shake
    const { analyze: treeShake } = await import("../tooling/tree-shake");
    const tsResult = treeShake(db);
    const tsColor = tsResult.total_dead > 0 ? "yellow" : "green";
    console.log("  " + badge("tree-shake", "dim") + "  " + badge(tsResult.total_dead + " dead", tsColor));

    // Tokens
    const { analyze: tokens } = await import("../tooling/token-budget");
    const tokResult = tokens(db);
    const tokColor = tokResult.alerts.length > 0 ? "yellow" : "green";
    console.log("  " + badge("tokens", "dim") + "     " + badge(tokResult.overall.total_tokens.toLocaleString() + " tokens", tokColor));

    // Profiler
    const { analyze: profile } = await import("../tooling/profiler");
    const profResult = profile(db);
    const profColor = profResult.bottlenecks.stuck_workers > 0 || profResult.bottlenecks.failed_workers > 0 ? "yellow" : "green";
    console.log("  " + badge("profile", "dim") + "    " + badge(profResult.bottlenecks.stuck_workers + " stuck, " + profResult.bottlenecks.failed_workers + " failed", profColor));

    // Cleanup
    const { scan: cleanup } = await import("../tooling/cleanup");
    const cleanResult = cleanup(db);
    const cleanColor = cleanResult.total_orphans > 0 ? "yellow" : "green";
    console.log("  " + badge("cleanup", "dim") + "    " + badge(cleanResult.total_orphans + " orphans", cleanColor));

    // Deps
    const { build: deps } = await import("../tooling/dep-graph");
    const depGraph = deps(db);
    const depColor = depGraph.circular_deps.length > 0 ? "red" : "green";
    console.log("  " + badge("deps", "dim") + "       " + badge(depGraph.nodes.length + " nodes, " + depGraph.edges.length + " edges", depColor));

    console.log("");
  },
};
