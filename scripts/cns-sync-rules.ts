#!/usr/bin/env bun
/**
 * CNS — Instruction File Sync
 * ============================
 * Injects the CNS protocol block into each harness's instruction file.
 * Creates missing files (GEMINI.md, .windsurfrules) with appropriate format.
 * Existing content is preserved — the CNS block is appended/updated only.
 *
 * Usage:
 *   bun scripts/cns-sync-rules.ts              # sync all detected harnesses
 *   bun scripts/cns-sync-rules.ts --dry-run    # show diffs, no writes
 *   bun scripts/cns-sync-rules.ts --harness windsurf,gemini-cli
 *   bun scripts/cns-sync-rules.ts --status     # show sync state
 *
 * Architecture: exported functions are called by `cns-setup.ts` wizard.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOME = homedir();
const TERMINAL_ROOT = resolve(join(import.meta.dir, ".."));

// ── CNS Protocol Block ───────────────────────────────────────────────────────
// Injected into every harness. Written once, updated on re-run.

const CNS_BLOCK_START = "<!-- CNS_PROTOCOL_START -->";
const CNS_BLOCK_END = "<!-- CNS_PROTOCOL_END -->";

const CNS_PROTOCOL_BLOCK = `${CNS_BLOCK_START}
## CNS Protocol — PMM Agentic Nervous System

This project uses PMM as a centralized nervous system. PMM tracks sessions,
workers, decisions, milestones, and roadblocks across all AI harnesses.

### On EVERY session start (mandatory):
1. **Call \`pmm_session_start\`** — registers you in the CNS
   - \`project\`: the project name you are working on  
   - \`harness\`: your harness ID (see below)
   - \`model\`: the model you are using
2. **Call \`pmm_context\`** — load current project state, milestones, decisions
3. **Call \`pmm_health_check\`** — surface any P0/P1 alerts before starting

### During work:
- **Milestone completed** → \`pmm_milestone_update(project, name, "completed")\`
- **Feature done** → \`pmm_feature_update(project, name, "done")\`
- **Architectural decision** → \`pmm_decision_add(project, question, decision, rationale)\`
- **Blocker found** → \`pmm_roadblock_add(project, description, "medium"|"high"|"critical")\`
- **Alert** → \`pmm_alert_create(project, "info"|"warning"|"critical", message)\`

### On EVERY session end (mandatory):
\`pmm_session_end(session_id, summary, files_edited: [], tokens_used?)\`

### Harness IDs:
- Claude Code → \`claude-code\`
- Antigravity → \`antigravity\`
- OpenCode → \`opencode\`
- Gemini CLI → \`gemini-cli\`
- Kilocode → \`kilocode\`
- Windsurf → \`windsurf\`

### PMM CLI (fallback if MCP unavailable):
\`\`\`
bun scripts/pmm.ts health
bun scripts/pmm.ts project list
bun scripts/pmm.ts summary
\`\`\`
${CNS_BLOCK_END}`;

// Windsurf uses a rules format instead of markdown prose
const CNS_WINDSURF_BLOCK = `${CNS_BLOCK_START}
# CNS Protocol — PMM Agentic Nervous System

## Rules

1. ALWAYS call pmm_session_start at the beginning of every session.
   Parameters: project (string), harness ("windsurf"), model (string).
   Store the returned session_id for use at session end.

2. ALWAYS call pmm_context after session start to load project state.

3. ALWAYS call pmm_session_end when the session completes.
   Parameters: session_id (number), summary (string), files_edited (array).

4. When you complete a milestone, call pmm_milestone_update.
5. When you complete a feature, call pmm_feature_update.
6. When you make an architectural decision, call pmm_decision_add.
7. When you encounter a blocker, call pmm_roadblock_add.

## Available PMM Tools
pmm_session_start | pmm_session_end | pmm_context | pmm_health_check
pmm_project_get | pmm_project_list | pmm_milestone_list | pmm_milestone_update
pmm_feature_list | pmm_feature_update | pmm_decision_list | pmm_decision_add
pmm_roadblock_add | pmm_alert_create | pmm_worker_dispatch | pmm_worker_update
pmm_summary | pmm_dependencies | pmm_process_scan
${CNS_BLOCK_END}`;

// Gemini CLI header (creates GEMINI.md from scratch if needed)
const GEMINI_MD_HEADER = `# GEMINI.md — CNS Project Protocol

This file is read by Gemini CLI at session start.
It defines mandatory behaviors for all Gemini CLI sessions in this workspace.

`;

// ── Harness Rule Manifest ─────────────────────────────────────────────────────

export interface RuleTarget {
  id: string;
  label: string;
  filePath: string;
  detect: () => boolean;
  block: string;
  /** If file doesn't exist, create it with this header + block */
  newFileHeader?: string;
}

export const RULE_TARGETS: RuleTarget[] = [
  {
    id: "claude-code",
    label: "Claude Code (CLAUDE.md)",
    filePath: join(TERMINAL_ROOT, ".claude", "CLAUDE.md"),
    detect: () => existsSync(join(TERMINAL_ROOT, ".claude", "CLAUDE.md")),
    block: CNS_PROTOCOL_BLOCK,
    // CLAUDE.md is already comprehensive — append CNS block only
    newFileHeader: undefined,
  },
  {
    id: "opencode",
    label: "OpenCode / Kilocode (AGENTS.md)",
    filePath: join(TERMINAL_ROOT, "AGENTS.md"),
    detect: () => true, // always sync AGENTS.md
    block: CNS_PROTOCOL_BLOCK,
    newFileHeader: `# AGENTS.md — CNS Project Protocol

This file is read by OpenCode, Kilocode, and Antigravity at session start.

`,
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI (GEMINI.md)",
    filePath: join(TERMINAL_ROOT, "GEMINI.md"),
    detect: () => true, // always generate
    block: CNS_PROTOCOL_BLOCK,
    newFileHeader: GEMINI_MD_HEADER,
  },
  {
    id: "windsurf",
    label: "Windsurf (.windsurfrules)",
    filePath: join(TERMINAL_ROOT, ".windsurfrules"),
    detect: () => true, // always generate
    block: CNS_WINDSURF_BLOCK,
    newFileHeader: `# .windsurfrules — Windsurf Cascade Rules
# Read by Windsurf IDE for this workspace.

`,
  },
];

// ── Core Functions ────────────────────────────────────────────────────────────

export interface SyncResult {
  target: string;
  label: string;
  status: "created" | "updated" | "already_synced" | "skipped" | "error";
  filePath: string;
  message?: string;
}

function injectBlock(existing: string, newBlock: string): { content: string; changed: boolean } {
  const hasBlock = existing.includes(CNS_BLOCK_START);

  if (!hasBlock) {
    // Append with blank line separator
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    return { content: existing + sep + newBlock + "\n", changed: true };
  }

  // Replace existing block
  const startIdx = existing.indexOf(CNS_BLOCK_START);
  const endIdx = existing.indexOf(CNS_BLOCK_END);
  if (endIdx === -1) {
    // Malformed — replace from start marker to end of file
    const content = existing.slice(0, startIdx) + newBlock + "\n";
    return { content, changed: content !== existing };
  }

  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + CNS_BLOCK_END.length);
  const newContent = before + newBlock + after;
  return { content: newContent, changed: newContent !== existing };
}

export function syncTarget(target: RuleTarget, opts: { dryRun?: boolean } = {}): SyncResult {
  const base: Omit<SyncResult, "status" | "message"> = {
    target: target.id,
    label: target.label,
    filePath: target.filePath,
  };

  try {
    if (!target.detect() && !target.newFileHeader) {
      return { ...base, status: "skipped", message: "harness not detected" };
    }

    let existing = "";
    let isNew = false;

    if (!existsSync(target.filePath)) {
      if (!target.newFileHeader) {
        return { ...base, status: "skipped", message: "file not found and no template defined" };
      }
      existing = target.newFileHeader ?? "";
      isNew = true;
    } else {
      existing = readFileSync(target.filePath, "utf-8");
    }

    const { content, changed } = injectBlock(existing, target.block);

    if (!changed && !isNew) {
      return { ...base, status: "already_synced", message: "CNS block up to date" };
    }

    if (opts.dryRun) {
      return {
        ...base,
        status: isNew ? "created" : "updated",
        message: `[dry-run] would ${isNew ? "create" : "update"} ${target.filePath}`,
      };
    }

    mkdirSync(dirname(target.filePath), { recursive: true });
    writeFileSync(target.filePath, content, "utf-8");

    return {
      ...base,
      status: isNew ? "created" : "updated",
      message: `${isNew ? "Created" : "Updated"} ${target.filePath}`,
    };
  } catch (err) {
    return { ...base, status: "error", message: String(err) };
  }
}

export function statusCheck(): Array<{
  target: string;
  label: string;
  exists: boolean;
  synced: boolean;
  filePath: string;
}> {
  return RULE_TARGETS.map((t) => {
    const exists = existsSync(t.filePath);
    let synced = false;
    if (exists) {
      try {
        const content = readFileSync(t.filePath, "utf-8");
        synced = content.includes(CNS_BLOCK_START);
      } catch { /* */ }
    }
    return { target: t.id, label: t.label, exists, synced, filePath: t.filePath };
  });
}

// ── CLI Entry Point ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isStatus = args.includes("--status");

const targetFilter = args
  .find((a) => a.startsWith("--harness="))
  ?.replace("--harness=", "")
  .split(",")
  .map((s) => s.trim());

if (isStatus) {
  const statuses = statusCheck();
  console.log("\n╔══ CNS Rule Sync Status ══╗");
  for (const s of statuses) {
    const exists = s.exists ? "✓ exists " : "✗ missing";
    const synced = s.synced ? "✓ synced " : "✗ not synced";
    console.log(`  ${s.label.padEnd(28)} │ ${exists} │ ${synced}`);
  }
  console.log("╚═══════════════════════════╝\n");
  process.exit(0);
}

const targets = targetFilter
  ? RULE_TARGETS.filter((t) => targetFilter.includes(t.id))
  : RULE_TARGETS;

console.log(`\n[cns-rules] Syncing CNS protocol${isDryRun ? " (dry-run)" : ""}...\n`);

const results: SyncResult[] = [];
for (const target of targets) {
  const result = syncTarget(target, { dryRun: isDryRun });
  results.push(result);

  const icon =
    result.status === "created" ? "+" :
    result.status === "updated" ? "↑" :
    result.status === "already_synced" ? "→" :
    result.status === "skipped" ? "·" : "✗";

  console.log(`  ${icon} ${result.label.padEnd(28)} ${result.message ?? ""}`);
}

const created = results.filter((r) => r.status === "created").length;
const updated = results.filter((r) => r.status === "updated").length;
const synced = results.filter((r) => r.status === "already_synced").length;
const errors = results.filter((r) => r.status === "error");

console.log(`\n  ${created} created, ${updated} updated, ${synced} already synced, ${errors.length} errors\n`);

if (errors.length > 0) {
  for (const e of errors) console.log(`  ✗ ${e.label}: ${e.message}`);
}
