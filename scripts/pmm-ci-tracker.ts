#!/usr/bin/env bun
/**
 * PMM CI/CD Tracker -- Git hook integration
 * =========================================
 * Populates build_runs/deploy_runs from CI operations.
 * Triggers: PostToolUse on Bash commands that look like builds/deploys.
 *
 * Usage: bun scripts/pmm-ci-tracker.ts <command-type> [options]
 *   command-type: build | deploy | ci
 *   --project <name>     : project name (default: auto-detect)
 *   --status <s>         : success | failed | running
 *   --duration <ms>      : execution duration
 *   --commit <sha>       : git commit SHA
 *   --branch <name>      : git branch
 *   --command "<cmd>"    : the command that was run
 *   --output "<text>"    : command output summary
 *   --artifact <path>    : build artifact path
 *   --env <e>            : deploy environment (dev/staging/production)
 *   --url "<url>"        : deploy URL
 */
import { openDb, queryOne, run } from "../src/db";

const args = process.argv.slice(2);
if (!args.length) { console.log("Usage: bun scripts/pmm-ci-tracker.ts <build|deploy|ci> [options]"); process.exit(1); }

const cmdType = args[0]!;
let projectName: string | null = null;
let status = "success";
let durationMs: number | null = null;
let commitSha: string | null = null;
let branch: string | null = null;
let command: string | null = null;
let output: string | null = null;
let artifactPath: string | null = null;
let env: string | null = null;
let url: string | null = null;
let trigger: string | null = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--project" && args[i + 1]) projectName = args[++i]!;
  else if (args[i] === "--status" && args[i + 1]) status = args[++i]!;
  else if (args[i] === "--duration" && args[i + 1]) durationMs = parseInt(args[++i]!);
  else if (args[i] === "--commit" && args[i + 1]) commitSha = args[++i]!;
  else if (args[i] === "--branch" && args[i + 1]) branch = args[++i]!;
  else if (args[i] === "--command" && args[i + 1]) command = args[++i]!;
  else if (args[i] === "--output" && args[i + 1]) output = args[++i]!;
  else if (args[i] === "--artifact" && args[i + 1]) artifactPath = args[++i]!;
  else if (args[i] === "--env" && args[i + 1]) env = args[++i]!;
  else if (args[i] === "--url" && args[i + 1]) url = args[++i]!;
  else if (args[i] === "--trigger" && args[i + 1]) trigger = args[++i]!;
}

const db = openDb();

try {
  // Auto-detect project
  if (!projectName) {
    if (!branch) {
      try {
        const proc = Bun.spawnSync(["git", "branch", "--show-current"]);
        branch = proc.stdout.toString().trim();
      } catch {}
    }
    projectName = "TERMINAL";
  }

  if (!commitSha) {
    try {
      const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
      commitSha = proc.stdout.toString().trim();
    } catch {}
  }

  const project = queryOne(db, "SELECT id FROM projects WHERE name = ?", [projectName]) as any;
  const projectId = project ? project.id : null;

  if (cmdType === "build") {
    run(db,
      `INSERT INTO build_runs (project_id, status, command, output, duration_ms, artifact_path, commit_sha, branch, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [projectId, status, command, output, durationMs, artifactPath, commitSha, branch]
    );
    console.log(`Build recorded: ${projectName} (${status})${durationMs ? ` ${durationMs}ms` : ""}`);
  } else if (cmdType === "deploy") {
    run(db,
      `INSERT INTO deploy_runs (project_id, status, environment, provider, url, output, duration_ms, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [projectId, status, env || "dev", "custom", url, output, durationMs]
    );
    console.log(`Deploy recorded: ${projectName} -> ${env || "dev"} (${status})`);
  } else if (cmdType === "ci") {
    run(db,
      `INSERT INTO ci_pipeline_runs (project_id, trigger, status, commit_sha, branch, duration_ms, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [projectId, trigger || "manual", status, commitSha, branch, durationMs]
    );
    console.log(`CI run recorded: ${projectName} (${status})`);
  } else {
    console.log(`Unknown command type: ${cmdType}. Use build, deploy, or ci.`);
  }
} finally {
  db.close();
}
