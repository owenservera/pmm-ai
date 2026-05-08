import { describe, expect, it } from "bun:test";
import type {
  AgentSpawner,
  CommandRunner,
  ExecCommandParams,
  ExecutionRuntime,
  InvokeSkillParams,
  LifecycleManager,
  SkillInvoker,
  SpawnAgentParams,
} from "../contract";

describe("Execution Contract (type-level)", () => {
  it("ExecutionRuntime bundles all four sub-interfaces", () => {
    const rt: ExecutionRuntime = {
      agents: {} as AgentSpawner,
      skills: {} as SkillInvoker,
      commands: {} as CommandRunner,
      lifecycle: {} as LifecycleManager,
    };
    expect(rt.agents).toBeDefined();
    expect(rt.skills).toBeDefined();
    expect(rt.commands).toBeDefined();
    expect(rt.lifecycle).toBeDefined();
  });

  it("SpawnAgentParams accepts all documented fields", () => {
    const params: SpawnAgentParams = {
      agentType: "pmm-architect",
      model: "sonnet",
      prompt: "Review architecture of my-app",
      project: "my-app",
      workerId: 42,
      runInBackground: true,
    };
    expect(params.agentType).toBe("pmm-architect");
    expect(params.workerId).toBe(42);
  });

  it("InvokeSkillParams accepts skill name and optional context", () => {
    const params: InvokeSkillParams = {
      skillName: "pmm-plan",
      context: { project: "my-app", mode: "deep" },
    };
    expect(params.skillName).toBe("pmm-plan");
    expect(params.context).toBeDefined();
  });

  it("ExecCommandParams accepts command with optional flags", () => {
    const params: ExecCommandParams = {
      command: "bun scripts/pmm.ts health",
      timeout: 10_000,
      background: false,
    };
    expect(params.command).toContain("pmm.ts");
    expect(params.timeout).toBe(10_000);
  });
});
