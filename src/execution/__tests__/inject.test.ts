/**
 * Tests for the Adapter Generator (inject.ts).
 *
 * Verifies:
 * - generateAdapter() produces valid TypeScript with correct substitutions
 * - Each harness profile generates unique adapter output
 * - generateInstructionBlock() produces valid markdown with correct primitives
 * - injectHarness() with dryRun=true writes nothing to disk
 * - injectHarness() with dryRun=false writes files and cleans up
 * - Generated class names are PascalCase of harness key
 * - Hook events map correctly to lifecycle methods
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HarnessProfile } from "../harnesses/discover";
import { generateAdapter, generateInstructionBlock, injectHarness } from "../inject";

// ── Mock Profiles (mirrors registry.json entries) ───────────────────────────

const CLAUDE_CODE_PROFILE: HarnessProfile = {
  name: "Claude Code",
  instruction_file: "CLAUDE.md",
  config_file: ".claude/settings.local.json",
  agent_spawn: "Task",
  skill_invoke: "Skill",
  command_run: "Bash",
  file_read: "Read",
  file_write: "Write",
  hook_mechanism: "settings.local.json hooks array",
  hook_events: ["SessionStart", "Stop", "PreToolUse", "PostToolUse", "UserPromptSubmit"],
  adapter_file: "adapters/claude-code.ts",
  status: "active",
};

const OPENCODE_PROFILE: HarnessProfile = {
  name: "OpenCode CLI",
  instruction_file: "AGENTS.md",
  config_file: "opencode.json",
  agent_spawn: "agent",
  skill_invoke: "skill",
  command_run: "terminal",
  file_read: "read",
  file_write: "write",
  hook_mechanism: "opencode.json hooks",
  hook_events: ["sessionStart", "sessionEnd", "preToolUse", "postToolUse"],
  adapter_file: "adapters/opencode.ts",
  status: "planned",
};

const KILOCODE_PROFILE: HarnessProfile = {
  name: "KiloCode CLI",
  instruction_file: "AGENTS.md",
  config_file: "kilocode.json",
  agent_spawn: "agent",
  skill_invoke: "skill",
  command_run: "terminal",
  file_read: "read",
  file_write: "write",
  hook_mechanism: "kilocode.json hooks",
  hook_events: ["sessionStart", "sessionEnd", "preToolUse", "postToolUse"],
  adapter_file: "adapters/kilocode.ts",
  status: "planned",
};

const GEMINI_CLI_PROFILE: HarnessProfile = {
  name: "Gemini CLI",
  instruction_file: "GEMINI.md",
  config_file: ".gemini/config.json",
  agent_spawn: "activate_skill",
  skill_invoke: "activate_skill",
  command_run: "shell",
  file_read: "file_read",
  file_write: "file_write",
  hook_mechanism: ".gemini/config.json triggers",
  hook_events: ["onSessionStart", "onSessionEnd", "onUserPrompt"],
  adapter_file: "adapters/gemini-cli.ts",
  status: "planned",
  notes:
    "Gemini CLI has no separate skill concept — skills ARE agents. Both spawn and invoke map to activate_skill.",
};

const ANTIGRAVITY_PROFILE: HarnessProfile = {
  name: "Antigravity IDE",
  instruction_file: ".antigravity/instructions.md",
  config_file: ".antigravity/config.json",
  agent_spawn: "task",
  skill_invoke: "skill",
  command_run: "terminal",
  file_read: "read_file",
  file_write: "write_file",
  hook_mechanism: ".antigravity/config.json events",
  hook_events: ["onOpen", "onClose", "onEdit", "onPrompt"],
  adapter_file: "adapters/antigravity.ts",
  status: "planned",
  notes:
    "IDE-native: persistent execution model, no session start/end in the CLI sense. Hooks map to workspace events.",
};

const ALL_PROFILES: { key: string; profile: HarnessProfile }[] = [
  { key: "claude-code", profile: CLAUDE_CODE_PROFILE },
  { key: "opencode", profile: OPENCODE_PROFILE },
  { key: "kilocode", profile: KILOCODE_PROFILE },
  { key: "gemini-cli", profile: GEMINI_CLI_PROFILE },
  { key: "antigravity", profile: ANTIGRAVITY_PROFILE },
];

/**
 * Expected PascalCase class name for each harness key.
 * Must match the toPascalCase logic in inject.ts (suffix-aware splitting).
 */
const EXPECTED_CLASS_NAMES: Record<string, string> = {
  "claude-code": "ClaudeCode",
  opencode: "OpenCode",
  kilocode: "KiloCode",
  "gemini-cli": "GeminiCli",
  antigravity: "Antigravity",
};

// ── Test Helpers ────────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inject-test-"));
}

function assertValidTypeScript(source: string): void {
  // Verify structural elements that valid TypeScript must contain
  expect(source).toContain("import type");
  expect(source).toContain("export class");
  expect(source).toContain("implements ExecutionRuntime");
  expect(source).toContain("export const runtime");
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("generateAdapter", () => {
  it("produces valid TypeScript with correct harness name and class name", () => {
    const source = generateAdapter(OPENCODE_PROFILE);

    assertValidTypeScript(source);
    expect(source).toContain("OpenCode CLI");
    expect(source).toContain("class OpenCodeAdapter");
    expect(source).toContain('readonly harness = "opencode"');
  });

  it("produces correct primitive references for each harness", () => {
    const source = generateAdapter(OPENCODE_PROFILE);

    expect(source).toContain("agent(");
    expect(source).toContain("skill(");
    expect(source).toContain("terminal(");
    expect(source).toContain("opencode.json hooks");
  });

  it("all 5 harnesses produce unique output", () => {
    const sources = ALL_PROFILES.map(({ key, profile }) => ({
      key,
      source: generateAdapter(profile),
    }));

    // Each must be unique
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        expect(sources[i].source).not.toBe(sources[j].source);
      }
    }

    // Each must contain its own class name
    for (const { key, source } of sources) {
      const expectedClass = EXPECTED_CLASS_NAMES[key];
      expect(source).toContain(`class ${expectedClass}Adapter`);
    }
  });

  it("generates PascalCase class name from harness key", () => {
    for (const [key, expectedClass] of Object.entries(EXPECTED_CLASS_NAMES)) {
      const profile = ALL_PROFILES.find((p) => p.key === key)?.profile ?? OPENCODE_PROFILE;
      const source = generateAdapter(profile);
      expect(source).toContain(`class ${expectedClass}Adapter`);
    }
  });

  it("includes singleton runtime export", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE);
    expect(source).toContain("export const runtime: ExecutionRuntime");
    expect(source).toContain("new ClaudeCodeAdapter()");
  });

  it("includes generated header with date", () => {
    const source = generateAdapter(OPENCODE_PROFILE);
    const today = new Date().toISOString().split("T")[0];
    expect(source).toContain(`Generated: ${today}`);
    expect(source).toContain("Generated by: bun scripts/pmm.ts exec inject --harness opencode");
  });

  it("includes decorative summary block with file_read and file_write", () => {
    const source = generateAdapter(ANTIGRAVITY_PROFILE);
    expect(source).toContain("read_file(");
    expect(source).toContain("write_file(");
    expect(source).toContain("Antigravity IDE Adapter");
    expect(source).toContain(".antigravity/instructions.md");
  });

  it("handles Gemini CLI with duplicate agent_spawn and skill_invoke", () => {
    const source = generateAdapter(GEMINI_CLI_PROFILE);
    expect(source).toContain("GeminiCliAdapter");
    expect(source).toContain("activate_skill(");
    // Both spawn and invoke should reference activate_skill
    expect(source.match(/activate_skill/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("handles Antigravity IDE profile", () => {
    const source = generateAdapter(ANTIGRAVITY_PROFILE);
    expect(source).toContain("AntigravityAdapter");
    expect(source).toContain("task(");
    expect(source).toContain("read_file(");
    expect(source).toContain("write_file(");
  });
});

describe("generateInstructionBlock", () => {
  it("produces valid markdown with correct primitive names", () => {
    const block = generateInstructionBlock(OPENCODE_PROFILE);

    expect(block).toContain("agent(");
    expect(block).toContain("skill(");
    expect(block).toContain("terminal(");
    expect(block).toContain("bun scripts/pmm.ts health");
    expect(block).toContain("contract.ts");
    expect(block).toContain("opencode");
  });

  it("includes PMM Platform Integration heading", () => {
    const block = generateInstructionBlock(CLAUDE_CODE_PROFILE);
    expect(block).toContain("## PMM Platform Integration");
  });

  it("references the adapter file path", () => {
    const block = generateInstructionBlock(OPENCODE_PROFILE);
    expect(block).toContain("adapters/opencode.ts");
  });

  it("references the contract and registry", () => {
    const block = generateInstructionBlock(KILOCODE_PROFILE);
    expect(block).toContain("src/pmm/execution/contract.ts");
    expect(block).toContain("src/pmm/execution/harnesses/registry.json → kilocode");
  });

  it("uses harness-native command_run for health check line", () => {
    const ccBlock = generateInstructionBlock(CLAUDE_CODE_PROFILE);
    expect(ccBlock).toContain('Bash("bun scripts/pmm.ts health")');

    const geminiBlock = generateInstructionBlock(GEMINI_CLI_PROFILE);
    expect(geminiBlock).toContain('shell("bun scripts/pmm.ts health")');
  });

  it("uses HTML comments for metadata", () => {
    const block = generateInstructionBlock(OPENCODE_PROFILE);
    expect(block).toContain("<!-- PMM Execution Framework");
    expect(block).toContain("Auto-generated delegation rules");
    const today = new Date().toISOString().split("T")[0];
    expect(block).toContain(`Generated: ${today}`);
  });
});

describe("injectHarness (dryRun)", () => {
  it("returns adapter path and does NOT write files when dryRun=true", () => {
    const result = injectHarness(OPENCODE_PROFILE, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.adapterPath).toBe("src/pmm/execution/adapters/opencode.ts");
    expect(result.instructionPath).toBeNull();
    expect(result.filesWritten).toEqual([]);
  });

  it("does not write adapter file when dryRun=true", () => {
    const adapterPath = "src/pmm/execution/adapters/opencode.ts";
    // Ensure file didn't exist before
    const existedBefore = fs.existsSync(adapterPath);

    const result = injectHarness(OPENCODE_PROFILE, { dryRun: true });

    // File should still be in same state
    expect(fs.existsSync(adapterPath)).toBe(existedBefore);
    expect(result.filesWritten).toEqual([]);
  });

  it("reports outputDir-based instruction path when outputDir provided (dryRun)", () => {
    const tmpDir = createTempDir();
    try {
      // Create the instruction file
      const instrPath = path.join(tmpDir, "AGENTS.md");
      fs.writeFileSync(instrPath, "# Existing content\n", "utf-8");

      const result = injectHarness(OPENCODE_PROFILE, {
        dryRun: true,
        outputDir: tmpDir,
      });

      // Should report the instruction path
      expect(result.instructionPath).toBe(instrPath);
      // But should NOT have written to it
      expect(fs.readFileSync(instrPath, "utf-8")).toBe("# Existing content\n");
      expect(result.filesWritten).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("injectHarness (file writes)", () => {
  it("writes adapter file to correct path with content", () => {
    // Use a temp directory as outputDir to not pollute real adapters
    const tmpDir = createTempDir();
    const cwd = process.cwd();
    try {
      process.chdir(tmpDir);

      const profile = { ...OPENCODE_PROFILE };
      const result = injectHarness(profile);

      expect(result.dryRun).toBe(false);
      expect(result.filesWritten).toHaveLength(1);
      expect(result.filesWritten[0]).toContain("opencode.ts");

      // Verify the file was written and contains valid content
      const writtenPath = result.filesWritten[0];
      expect(fs.existsSync(writtenPath)).toBe(true);
      const content = fs.readFileSync(writtenPath, "utf-8");
      expect(content).toContain("class OpenCodeAdapter");
      expect(content).toContain('readonly harness = "opencode"');
      expect(content).toContain("export const runtime: ExecutionRuntime");

      // Clean up
      fs.rmSync(writtenPath, { force: true });
      const dir = path.dirname(writtenPath);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writes adapter AND appends instruction file when outputDir provided", () => {
    const tmpDir = createTempDir();
    const cwd = process.cwd();
    try {
      process.chdir(tmpDir);

      // Create instruction file
      const instrPath = path.join(tmpDir, "AGENTS.md");
      fs.writeFileSync(instrPath, "# My Harness\n\nExisting content.\n", "utf-8");

      const result = injectHarness(OPENCODE_PROFILE, {
        outputDir: tmpDir,
      });

      // Should have written 2 files
      expect(result.filesWritten).toHaveLength(2);

      // Adapter file
      expect(fs.existsSync(result.filesWritten[0])).toBe(true);

      // Instruction file should have appended content (not overwritten)
      const instrContent = fs.readFileSync(instrPath, "utf-8");
      expect(instrContent).toContain("# My Harness");
      expect(instrContent).toContain("Existing content.");
      expect(instrContent).toContain("## PMM Platform Integration");
      expect(instrContent).toContain("agent(");

      // Clean up
      for (const f of result.filesWritten) {
        if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      }
      const dir = path.dirname(result.filesWritten[0]);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("does not append instruction block when instruction file is missing (outputDir provided)", () => {
    const tmpDir = createTempDir();
    const cwd = process.cwd();
    try {
      process.chdir(tmpDir);

      // Don't create AGENTS.md — it's missing
      const result = injectHarness(OPENCODE_PROFILE, {
        outputDir: tmpDir,
      });

      // Only adapter file written
      expect(result.filesWritten).toHaveLength(1);
      expect(result.instructionPath).toBeNull();

      // Clean up
      for (const f of result.filesWritten) {
        if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      }
      const dir = path.dirname(result.filesWritten[0]);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("hook event mapping", () => {
  it("maps first hook event to onSessionStart comment", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE);
    expect(source).toContain("settings.local.json hooks array → SessionStart");
  });

  it("maps second hook event to onSessionEnd comment", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE);
    expect(source).toContain("settings.local.json hooks array → Stop");
  });

  it("maps third hook event to onPreToolUse comment", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE);
    expect(source).toContain("settings.local.json hooks array → PreToolUse");
  });

  it("maps fourth hook event to onPostToolUse comment", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE);
    expect(source).toContain("settings.local.json hooks array → PostToolUse");
  });

  it("maps fifth hook event to onUserPromptSubmit comment", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE);
    expect(source).toContain("settings.local.json hooks array → UserPromptSubmit");
  });

  it("handles fewer than 5 hook events by marking rest as unmapped", () => {
    // Gemini has only 3 hook events
    const source = generateAdapter(GEMINI_CLI_PROFILE);
    expect(source).toContain(".gemini/config.json triggers → onSessionStart");
    expect(source).toContain(".gemini/config.json triggers → onSessionEnd");
    expect(source).toContain(".gemini/config.json triggers → onUserPrompt");
    // 4th and 5th should be marked unmapped
    expect(source).toContain("Not mapped — no corresponding hook event");
    expect(source.match(/Not mapped/g)?.length).toBe(2);
  });

  it("handles Antigravity with 4 hook events", () => {
    const source = generateAdapter(ANTIGRAVITY_PROFILE);
    expect(source).toContain(".antigravity/config.json events → onOpen");
    expect(source).toContain(".antigravity/config.json events → onClose");
    expect(source).toContain(".antigravity/config.json events → onEdit");
    expect(source).toContain(".antigravity/config.json events → onPrompt");
    // 5th should be unmapped
    expect(source).toContain("Not mapped — no corresponding hook event");
  });

  it("maps events correctly for OpenCode with 4 hook events", () => {
    const source = generateAdapter(OPENCODE_PROFILE);
    expect(source).toContain("opencode.json hooks → sessionStart");
    expect(source).toContain("opencode.json hooks → sessionEnd");
    expect(source).toContain("opencode.json hooks → preToolUse");
    expect(source).toContain("opencode.json hooks → postToolUse");
    expect(source).toContain("Not mapped — no corresponding hook event");
  });
});

describe("edge cases", () => {
  it("ClaudeCodeAdapter uses Claude Code specific primitives", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE);
    expect(source).toContain("Task(");
    expect(source).toContain("Skill(");
    expect(source).toContain("Bash(");
  });

  it("each generated adapter imports from contract and claude-code", () => {
    for (const { profile } of ALL_PROFILES) {
      const source = generateAdapter(profile);
      expect(source).toContain("import type {");
      expect(source).toContain('from "../contract"');
      expect(source).toContain('from "./claude-code"');
    }
  });

  it("instruction block is always appended (never overwrites)", () => {
    const tmpDir = createTempDir();
    try {
      const instrPath = path.join(tmpDir, "TEST.md");
      const originalContent = "# Original\nKeep me intact.\n";
      fs.writeFileSync(instrPath, originalContent, "utf-8");

      const profile: HarnessProfile = {
        ...OPENCODE_PROFILE,
        instruction_file: "TEST.md",
      };

      injectHarness(profile, { outputDir: tmpDir });

      const content = fs.readFileSync(instrPath, "utf-8");
      expect(content).toContain(originalContent.trim());
      expect(content).toContain("## PMM Platform Integration");
      // Original content should be before the new block
      expect(content.indexOf("Keep me intact.")).toBeLessThan(
        content.indexOf("PMM Platform Integration"),
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("handles passing harnessKey explicitly to generateAdapter", () => {
    const source = generateAdapter(CLAUDE_CODE_PROFILE, "claude-code");
    expect(source).toContain("class ClaudeCodeAdapter");
    expect(source).toContain('readonly harness = "claude-code"');
  });
});
