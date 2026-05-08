#!/usr/bin/env bun
/**
 * PMM Tool Health Monitor
 * ========================
 * Checks installed tool versions against registered versions.
 * Detects version drift and updates tooling table.
 *
 * Usage: bun scripts/pmm-tool-health.ts [--check] [--update] [--project <name>]
 */
import { openDb, queryAll, queryOne, run } from "../src/db";

const args = process.argv.slice(2);
const checkMode = args.includes("--check") || args.length === 0;
const updateMode = args.includes("--update");
let projectFilter: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--project" && args[i + 1]) projectFilter = args[++i]!;
}

const db = openDb();

try {
  let sql = "SELECT t.*, p.name as project_name FROM tooling t JOIN projects p ON t.project_id = p.id WHERE t.installed_version IS NOT NULL";
  const params: any[] = [];
  if (projectFilter) { sql += " AND p.name = ?"; params.push(projectFilter); }
  sql += " ORDER BY p.name, t.tool_name";

  const tools = queryAll(db, sql, params) as any[];
  if (!tools.length) { console.log("No tools with version tracking found."); process.exit(0); }

  console.log(`=== Tool Version Health (${tools.length} tools) ===\n`);

  let driftCount = 0;
  for (const tool of tools) {
    let currentVersion: string | null = null;

    // Try to detect current version
    try {
      const proc = Bun.spawnSync(["bun", "--version"], { stdout: "pipe" });
      const ver = proc.stdout.toString().trim();

      if (tool.tool_name === "Bun" || tool.tool_name === "bun") {
        currentVersion = ver;
      } else if (tool.tool_name === "Biome") {
        const biome = Bun.spawnSync(["bunx", "biome", "--version"], { stdout: "pipe" });
        currentVersion = biome.stdout.toString().trim();
      } else if (tool.tool_name === "lefthook") {
        const lh = Bun.spawnSync(["bunx", "lefthook", "version"], { stdout: "pipe" });
        currentVersion = lh.stdout.toString().trim();
      } else if (tool.tool_name === "esbuild") {
        const esb = Bun.spawnSync(["bunx", "esbuild", "--version"], { stdout: "pipe" });
        currentVersion = esb.stdout.toString().trim();
      } else if (tool.tool_name === "Vitest") {
        const vit = Bun.spawnSync(["bunx", "vitest", "--version"], { stdout: "pipe" });
        currentVersion = vit.stdout.toString().trim();
      } else if (tool.tool_name === "Hono") {
        try {
          const pkg = await import("../../package.json") as any;
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.hono) currentVersion = deps.hono.replace(/^[\^~]/, "");
        } catch {}
      }
    } catch {
      // Version check not available for this tool
    }

    const installed = tool.installed_version;
    const status = currentVersion
      ? (currentVersion !== installed ? "drift" : "current")
      : "unknown";

    console.log(`  ${tool.tool_name.padEnd(20)} [${tool.project_name}]`);
    console.log(`    Registered: ${installed}  |  Detected: ${currentVersion || "N/A"}  |  ${status}`);

    if (status === "drift") driftCount++;

    // Update if requested
    if (updateMode && currentVersion && currentVersion !== installed) {
      run(db, "UPDATE tooling SET installed_version = ? WHERE id = ?", [currentVersion, tool.id]);
      console.log(`    → Updated to ${currentVersion}`);
    }
  }

  console.log(`\n  Drift detected: ${driftCount}/${tools.length} tools`);

  // Feed into oracle for patterns
  if (driftCount > 0) {
    const exists = queryOne(db,
      "SELECT id FROM oracle_insights WHERE title = 'Tool version drift detected' AND created_at > datetime('now', '-7 days')"
    );
    if (!exists) {
      run(db,
        `INSERT INTO oracle_insights (category, title, description, source, confidence, impact_score, feasibility, status)
         VALUES ('observation', 'Tool version drift detected', ?, 'tool-health', 0.95, 0.50, 0.90, 'new')`,
        [`${driftCount} of ${tools.length} tracked tools have version drift. Consider running: bun scripts/pmm-tool-health.ts --update`]
      );
    }
  }
} finally {
  db.close();
}
