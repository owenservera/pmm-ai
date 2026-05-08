/**
 * PMM Memory Bridge Commands
 * ==========================
 * mem search/recent/context/sync/inject/status
 * Delegates to pmm-mem-bridge.ts for claude-mem integration.
 */
import type { Database } from "bun:sqlite";
import { getProjectId } from "../db";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  "mem:search": async (_db, args) => {
    const query = args[0];
    if (!query) { console.error("Usage: bun scripts/pmm.ts mem search <query> [--limit N]"); process.exit(1); }
    let limit = 10;
    for (let i = 1; i < args.length; i++) { if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i]!, 10); }
    const proc = Bun.spawnSync(["bun", "scripts/pmm-mem-bridge.ts", "search", query, "--limit", String(limit)], { cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe" });
    if (proc.stderr.toString()) console.error(proc.stderr.toString());
    const results = JSON.parse(proc.stdout.toString());
    if (results.length === 0) { console.log("No matching observations found."); }
    else { console.table(results.map((r: any) => ({ id: r.id, type: r.type, title: r.title, project: r.project, created: r.created_at }))); }
  },

  "mem:recent": async (_db, args) => {
    let project = ""; let limit = 10;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) project = args[++i]!;
      else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i]!, 10);
    }
    if (!project) { console.error("Error: --project is required"); process.exit(1); }
    const proc = Bun.spawnSync(["bun", "scripts/pmm-mem-bridge.ts", "recent", "--project", project, "--limit", String(limit)], { cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe" });
    if (proc.stderr.toString()) console.error(proc.stderr.toString());
    const results = JSON.parse(proc.stdout.toString());
    if (results.length === 0) { console.log(`No observations found for project "${project}".`); }
    else { console.table(results.map((r: any) => ({ id: r.id, type: r.type, title: r.title, created: r.created_at }))); }
  },

  "mem:context": async (_db, args) => {
    let project = "";
    for (let i = 0; i < args.length; i++) { if (args[i] === "--project" && args[i + 1]) project = args[++i]!; }
    if (!project) { console.error("Error: --project is required"); process.exit(1); }
    const proc = Bun.spawnSync(["bun", "scripts/pmm-mem-bridge.ts", "context", "--project", project], { cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe" });
    if (proc.stderr.toString()) console.error(proc.stderr.toString());
    const results = JSON.parse(proc.stdout.toString());
    console.log(`Project: ${results.project}`);
    console.log(`Recent observations: ${results.recent_observations.length}`);
    for (const obs of results.recent_observations) { console.log(`  [${obs.type}] ${obs.title} (${obs.created_at})`); }
  },

  "mem:sync": async (db, args) => {
    let project = "";
    for (let i = 0; i < args.length; i++) { if (args[i] === "--project" && args[i + 1]) project = args[++i]!; }
    if (!project) {
      try {
        const fs = require("node:fs"); const path = require("node:path");
        const sessionPath = path.join(import.meta.dir, "..", "..", "state", "current-session.json");
        if (fs.existsSync(sessionPath)) { const session = JSON.parse(fs.readFileSync(sessionPath, "utf8")); project = session.project || "TERMINAL"; }
        else project = "TERMINAL";
      } catch { project = "TERMINAL"; }
    }
    if (!getProjectId(db, project)) { console.error(`⚠️  Project "${project}" not registered in PMM DB. Falling back to TERMINAL.`); project = "TERMINAL"; }
    console.log(`Syncing PMM state for "${project}" to claude-mem...`);
    const proc = Bun.spawnSync(["bun", "scripts/pmm-mem-bridge.ts", "sync", "--project", project], { cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe" });
    if (proc.stderr.toString()) console.error(proc.stderr.toString());
    const result = JSON.parse(proc.stdout.toString());
    if (result.ok) { console.log(`State sync complete for "${project}".`); }
    else { console.error(`State sync failed. Check project name and PMM DB.`); process.exit(1); }
  },

  "mem:inject": async (_db, args) => {
    if (!args[0]) { console.error('Usage: bun scripts/pmm.ts mem inject < \'{"type":"...", ...}\''); process.exit(1); }
    const proc = Bun.spawnSync(["bun", "scripts/pmm-mem-bridge.ts", "inject"], { cwd: import.meta.dir + "/../..", stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    if (proc.stderr.toString()) console.error(proc.stderr.toString());
    const result = JSON.parse(proc.stdout.toString());
    console.log(result.ok ? "Observation injected." : "Inject failed.");
  },

  "mem:status": async (_db, _args) => {
    const proc = Bun.spawnSync(["bun", "scripts/pmm-mem-bridge.ts", "status"], { cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe" });
    if (proc.stderr.toString()) console.error(proc.stderr.toString());
    const s = JSON.parse(proc.stdout.toString());
    console.log(`Bridge Status:`);
    console.log(`  Accessible:     ${s.accessible}`);
    console.log(`  Observations:   ${s.observationCount}`);
    console.log(`  DB Path:        ${s.dbPath}`);
  },
};
