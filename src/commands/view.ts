/**
 * PMM Visualization — CLI Command Handler
 * =========================================
 * Commands:
 *   bun scripts/cli.ts view <project>                    — Single-project dashboard
 *   bun scripts/cli.ts view <project> --type <type>      — Specific chart type
 *   bun scripts/cli.ts dashboard                         — Portfolio dashboard
 *   bun scripts/cli.ts dashboard --live [--port <n>]     — Live dashboard server
 */
import type { Database } from "bun:sqlite";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { openVisualizationDB, fetchProjectData, fetchPortfolioData } from "../visualization/data";
import { generateProjectDashboard, generatePortfolioDashboard } from "../visualization/generator";
import { startLiveServer } from "../visualization/server";

const ROOT = join(import.meta.dir, "..", "..", "..");

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  view: async (_db, args) => {
    if (args.length < 1) {
      console.log("Usage: bun scripts/cli.ts view <project> [--type all|gantt|kanban|timeline|health|burndown] [--output <path>] [--no-open]");
      console.log("");
      console.log("Charts:");
      console.log("  all        — Full dashboard with all chart types");
      console.log("  gantt      — Milestone timeline (Gantt chart)");
      console.log("  kanban     — Feature kanban board");
      console.log("  health     — Health gauges + score cards");
      console.log("  timeline   — Task deep-dive vertical timeline");
      console.log("  burndown   — Task burndown line chart");
      process.exit(0);
    }

    const projectName = args[0]!;
    let filterType = "all";
    let outputPath: string | null = null;
    let noOpen = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--type" && args[i + 1]) { filterType = args[++i]!; }
      else if (args[i] === "--output" && args[i + 1]) { outputPath = args[++i]!; }
      else if (args[i] === "--no-open") { noOpen = true; }
    }

    try {
      const vizDb = openVisualizationDB();
      const project = vizDb.query("SELECT id, name, phase, priority, health, status, repo_path FROM projects WHERE name = ?").get(projectName) as any;
      if (!project) { vizDb.close(); console.log(`Error: Project "${projectName}" not found.`); process.exit(1); }

      console.log(`Generating dashboard for "${project.name}"...`);
      const data = fetchProjectData(vizDb, project.id);
      vizDb.close();

      if (!data) { console.log(`Error: Could not fetch data for project "${projectName}".`); process.exit(1); }

      const totalItems = data.milestones.length + data.features.length + data.tasks.length;
      if (totalItems === 0) console.log(`Warning: Project "${projectName}" has no milestones, features, or tasks yet.`);

      const html = generateProjectDashboard(data, filterType);

      if (!outputPath) {
        const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
        outputPath = join(ROOT, "PMM", safeName, "dashboard.html");
        const dir = join(ROOT, "PMM", safeName);
        if (!existsSync(dir)) { try { require("fs").mkdirSync(dir, { recursive: true }); } catch {} }
      }

      writeFileSync(outputPath, html, "utf-8");
      const sizeKB = Math.round(html.length / 1024);
      console.log(`Dashboard written to ${outputPath}`);
      console.log(`   Size: ${sizeKB} KB | Type: ${filterType}`);

      if (!noOpen) {
        try {
          const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
          spawn(cmd, [outputPath], { detached: true, stdio: "ignore" });
          console.log(`   Opened in browser.`);
        } catch { console.log(`   Open manually: file://${outputPath}`); }
      }
    } catch (e: any) { console.log(`Error generating dashboard: ${e.message}`); process.exit(1); }
  },

  dashboard: async (_db, args) => {
    let isLive = false; let port = 9998; let outputPath: string | null = null; let noOpen = false; let projectFilter: string[] = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--live") { isLive = true; }
      else if (args[i] === "--port" && args[i + 1]) { port = parseInt(args[++i]!); }
      else if (args[i] === "--output" && args[i + 1]) { outputPath = args[++i]!; }
      else if (args[i] === "--no-open") { noOpen = true; }
      else if (args[i] === "--projects" && args[i + 1]) { projectFilter = args[++i]!.split(",").map((s: string) => s.trim()); }
    }

    if (isLive) { startLiveServer(port, !noOpen); return; }

    try {
      console.log(`Generating portfolio dashboard...`);
      const vizDb = openVisualizationDB();
      const portfolioData = fetchPortfolioData(vizDb);
      vizDb.close();

      if (projectFilter.length > 0) { portfolioData.projects = portfolioData.projects.filter((p: any) => projectFilter.includes(p.name)); }
      if (portfolioData.projects.length === 0) { console.log(`Warning: No projects found.`); process.exit(1); }

      const html = generatePortfolioDashboard(portfolioData);
      if (!outputPath) { outputPath = join(ROOT, "PMM", "dashboard.html"); }

      writeFileSync(outputPath, html, "utf-8");
      const sizeKB = Math.round(html.length / 1024);
      console.log(`Portfolio dashboard written to ${outputPath}`);
      console.log(`   Size: ${sizeKB} KB | Projects: ${portfolioData.projects.length} | Workers: ${portfolioData.workers.length}`);

      if (!noOpen) {
        try {
          const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
          spawn(cmd, [outputPath], { detached: true, stdio: "ignore" });
          console.log(`   Opened in browser.`);
        } catch { console.log(`   Open manually: file://${outputPath}`); }
      }
    } catch (e: any) { console.log(`Error generating portfolio dashboard: ${e.message}`); process.exit(1); }
  },
};
