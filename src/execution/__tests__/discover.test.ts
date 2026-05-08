/**
 * Tests for the Harness Auto-Discovery Engine.
 *
 * Uses temporary directories with mock files to verify detection of
 * harness name, config files, hook events, and execution primitives.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverHarness } from "../harnesses/discover";

// -- Test Helpers ------------------------------------------------------------

/**
 * Create a temporary directory with the given file tree.
 * Keys are relative file paths, values are file contents.
 * The caller is responsible for cleanup with fs.rmSync(dir, { recursive: true }).
 */
function createMockDir(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-disc-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }
  return tmpDir;
}

// -- Tests -------------------------------------------------------------------

describe("discoverHarness", () => {
  describe("name detection", () => {
    it("reads name from package.json", () => {
      const dir = createMockDir({
        "package.json": JSON.stringify({ name: "@scope/my-harness" }),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.harnessName).toBe("@scope/my-harness");
        expect(result.profile.name).toBe("@scope/my-harness");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("falls back to directory name when no package.json", () => {
      const dir = createMockDir({});
      try {
        const result = discoverHarness(dir);
        expect(result.harnessName).toBe(path.basename(dir));
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("falls back to directory name when package.json has no name", () => {
      const dir = createMockDir({
        "package.json": JSON.stringify({ version: "1.0.0" }),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.harnessName).toBe(path.basename(dir));
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("instruction file detection", () => {
    it("detects CLAUDE.md", () => {
      const dir = createMockDir({
        "CLAUDE.md": "# Instructions",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.instruction_file).toBe("CLAUDE.md");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("detects AGENTS.md", () => {
      const dir = createMockDir({
        "AGENTS.md": "# Agents",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.instruction_file).toBe("AGENTS.md");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("detects .harness/instructions.md", () => {
      const dir = createMockDir({
        ".harness/instructions.md": "# Harness instructions",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.instruction_file).toBe(".harness/instructions.md");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("config file detection", () => {
    it("finds config by harness name", () => {
      const dir = createMockDir({
        "package.json": JSON.stringify({ name: "my-harness" }),
        "my-harness.json": JSON.stringify({ hooks: { sessionStart: [] } }),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.config_file).toBe("my-harness.json");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("finds .json files with config in name", () => {
      const dir = createMockDir({
        "config.json": JSON.stringify({ settings: { hooks: { onOpen: [] } } }),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.config_file).toBe("config.json");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("extracts hook events from config hooks key (name-matched)", () => {
      const dir = createMockDir({
        "config-settings.json": JSON.stringify({
          hooks: {
            sessionStart: ["log"],
            sessionEnd: ["cleanup"],
          },
        }),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.config_file).toBe("config-settings.json");
        expect(result.profile.hook_events?.sort()).toEqual(["sessionEnd", "sessionStart"]);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("extracts hook events from events key", () => {
      const dir = createMockDir({
        "settings.json": JSON.stringify({
          events: {
            onSessionStart: [],
            onSessionEnd: [],
          },
        }),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.hook_events?.sort()).toEqual(["onSessionEnd", "onSessionStart"]);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("primitive detection from docs", () => {
    it("detects Task as agent spawn from README.md (tool reference, conf 0.7)", () => {
      const dir = createMockDir({
        "README.md":
          "# My Harness\n\n## Tools\n- Task() \u2014 spawn subagents\n- Bash() \u2014 run commands",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.agent_spawn).toBe("Task");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("detects Skill as skill invoke from README.md", () => {
      const dir = createMockDir({
        "README.md":
          "# My Harness\n\n## Tools\n- Skill() \u2014 invoke skills\n- Task() \u2014 spawn agents",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.skill_invoke).toBe("Skill");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("detects Bash as command run from README.md", () => {
      const dir = createMockDir({
        "README.md": "# My Harness\n\n## Tools\n- Bash() \u2014 run shell commands",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.command_run).toBe("Bash");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("detects exact function signatures (confidence 1.0)", () => {
      const dir = createMockDir({
        "README.md": [
          "## API",
          "function task(type, prompt) \u2014 spawn an agent",
          "function skill(name, input) \u2014 invoke a skill",
          "function bash(cmd) \u2014 run a command",
        ].join("\n"),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.agent_spawn).toBe("task");
        expect(result.profile.skill_invoke).toBe("skill");
        expect(result.profile.command_run).toBe("bash");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("detects file read/write primitives", () => {
      const dir = createMockDir({
        "README.md": "# API\n- Read() \u2014 read a file\n- Write() \u2014 write a file",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.file_read).toBe("Read");
        expect(result.profile.file_write).toBe("Write");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("searches docs/tools.md and AGENTS.md when README.md absent", () => {
      const dir = createMockDir({
        "docs/tools.md": "# Tools\n- Task() \u2014 agents\n- Bash() \u2014 commands",
      });
      try {
        const result = discoverHarness(dir);
        expect(result.profile.agent_spawn).toBe("Task");
        expect(result.profile.command_run).toBe("Bash");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("confidence scoring", () => {
    it("returns low confidence for empty/invalid directory", () => {
      const dir = createMockDir({});
      try {
        const result = discoverHarness(dir);
        // Only name is detected (from dirname), so confidence = 1/12 ~ 0.08
        expect(result.confidence).toBeLessThan(0.5);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0]).toContain("confidence below threshold");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("returns high confidence with comprehensive harness directory", () => {
      const dir = createMockDir({
        "package.json": JSON.stringify({ name: "full-harness" }),
        "README.md": [
          "## Tools",
          "- Task() \u2014 spawn agents",
          "- Skill() \u2014 invoke skills",
          "- Bash() \u2014 run commands",
          "- Read() \u2014 read files",
          "- Write() \u2014 write files",
        ].join("\n"),
        "CLAUDE.md": "# Full harness",
        "full-harness.json": JSON.stringify({
          hooks: {
            sessionStart: [],
            sessionEnd: [],
          },
        }),
      });
      try {
        const result = discoverHarness(dir);
        // 10/12 fields detected (all except adapter_file and status)
        // adapter_file and status are not detected from the harness path alone
        expect(result.confidence).toBeCloseTo(10 / 12, 2);
        expect(result.profile.name).toBe("full-harness");
        expect(result.profile.instruction_file).toBe("CLAUDE.md");
        expect(result.profile.config_file).toBe("full-harness.json");
        expect(result.profile.agent_spawn).toBe("Task");
        expect(result.profile.skill_invoke).toBe("Skill");
        expect(result.profile.command_run).toBe("Bash");
        expect(result.profile.file_read).toBe("Read");
        expect(result.profile.file_write).toBe("Write");
        expect(result.profile.hook_mechanism).toBe("full-harness.json hooks");
        expect(result.profile.hook_events).toBeDefined();
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("error handling", () => {
    it("returns gracefully for non-existent path", () => {
      const result = discoverHarness("/nonexistent/harness/path");
      expect(result.harnessName).toBe("path");
      expect(result.confidence).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("does not exist");
    });

    it("returns gracefully for path to a file (not directory)", () => {
      const dir = createMockDir({ "file.txt": "not a directory" });
      const filePath = path.join(dir, "file.txt");
      try {
        // fs.existsSync is true for files, but readdir would fail
        // Only name is detected (from path basename), so confidence = 1/12 ~ 0.08
        const result = discoverHarness(filePath);
        expect(result.confidence).toBeCloseTo(1 / 12, 2);
        expect(result.harnessName).toBe("file.txt");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("handles unparseable JSON in config file", () => {
      const dir = createMockDir({
        "my-harness.json": "not valid json",
        "package.json": JSON.stringify({ name: "my-harness" }),
      });
      try {
        // Should skip the invalid JSON and not throw
        const result = discoverHarness(dir);
        expect(result.profile.config_file).toBeUndefined();
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("full harness scenario", () => {
    it("discovers a full harness profile from a mock directory", () => {
      const dir = createMockDir({
        "package.json": JSON.stringify({ name: "claude-code" }),
        "CLAUDE.md": "# Claude Code Instructions",
        "settings.json": JSON.stringify({
          hooks: {
            SessionStart: [],
            Stop: [],
            PreToolUse: [],
            PostToolUse: [],
            UserPromptSubmit: [],
          },
        }),
        "README.md": [
          "# Claude Code",
          "",
          "## Primitives",
          "- Task() \u2014 spawn subagents",
          "- Skill() \u2014 activate skills",
          "- Bash() \u2014 execute commands",
          "- Read() \u2014 read files",
          "- Write() \u2014 write files",
        ].join("\n"),
      });
      try {
        const result = discoverHarness(dir);
        expect(result.harnessName).toBe("claude-code");
        expect(result.profile.instruction_file).toBe("CLAUDE.md");
        expect(result.profile.config_file).toBe("settings.json");
        expect(result.profile.agent_spawn).toBe("Task");
        expect(result.profile.skill_invoke).toBe("Skill");
        expect(result.profile.command_run).toBe("Bash");
        expect(result.profile.file_read).toBe("Read");
        expect(result.profile.file_write).toBe("Write");
        expect(result.profile.hook_mechanism).toBe("settings.json hooks");
        expect(result.profile.hook_events?.sort()).toEqual([
          "PostToolUse",
          "PreToolUse",
          "SessionStart",
          "Stop",
          "UserPromptSubmit",
        ]);
        expect(result.confidence).toBeGreaterThan(0.8);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });
});
