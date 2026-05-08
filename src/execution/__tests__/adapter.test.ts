import { describe, expect, it } from "bun:test";
import {
  buildWorkerPrompt,
  CLAUDE_CODE_MAPPING,
  ClaudeCodeAdapter,
  injectWorkerTracking,
} from "../adapters/claude-code";

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  it("reports harness as claude-code", () => {
    expect(adapter.harness).toBe("claude-code");
  });

  it("has all four sub-interfaces", () => {
    expect(adapter.agents).toBeDefined();
    expect(adapter.skills).toBeDefined();
    expect(adapter.commands).toBeDefined();
    expect(adapter.lifecycle).toBeDefined();
  });

  it("mapping documents all four contract methods", () => {
    expect(CLAUDE_CODE_MAPPING.agents.spawn).toContain("Task");
    expect(CLAUDE_CODE_MAPPING.skills.invoke).toContain("Skill");
    expect(CLAUDE_CODE_MAPPING.commands.exec).toContain("Bash");
    expect(CLAUDE_CODE_MAPPING.lifecycle.register).toContain("settings.local.json");
  });
});

describe("buildWorkerPrompt", () => {
  it("includes worker ID in tracking instructions", () => {
    const prompt = buildWorkerPrompt(42);
    expect(prompt).toContain("#42");
    expect(prompt).toContain("worker update 42");
    expect(prompt).toContain("--status running");
    expect(prompt).toContain("--status completed");
    expect(prompt).toContain("--status failed");
  });
});

describe("injectWorkerTracking", () => {
  it("appends tracking when workerId provided", () => {
    const result = injectWorkerTracking("Score health", 99);
    expect(result).toContain("Score health");
    expect(result).toContain("#99");
  });

  it("returns prompt unchanged when no workerId", () => {
    const result = injectWorkerTracking("Score health");
    expect(result).toBe("Score health");
  });
});
