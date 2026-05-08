/**
 * PMM Execution Framework — Public API
 *
 * Usage:
 *   import { runtime, injectWorkerTracking, CLAUDE_CODE_MAPPING } from "../execution";
 *
 *   const prompt = injectWorkerTracking("Score health for all projects", workerId);
 *   // runtime.agents.spawn({ agentType: "pmm-health-scorer", model: "sonnet", prompt });
 */

export {
  buildWorkerPrompt,
  CLAUDE_CODE_MAPPING,
  ClaudeCodeAdapter,
  injectWorkerTracking,
  runtime,
} from "./adapters/claude-code";
export type {
  AgentHandle,
  AgentSpawner,
  CommandResult,
  CommandRunner,
  ExecCommandParams,
  ExecutionRuntime,
  InvokeSkillParams,
  LifecycleManager,
  SkillInvoker,
  SkillResult,
  SpawnAgentParams,
  WorkerResult,
} from "./contract";

// Harness registry — available programmatically and via CLI: bun scripts/pmm.ts exec harnesses
// Validation: bun run src/pmm/execution/harnesses/validate.ts
export { default as harnessRegistry } from "./harnesses/registry.json";
