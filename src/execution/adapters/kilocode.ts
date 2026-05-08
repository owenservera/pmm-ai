/**
 * PMM Execution Framework -- KiloCode CLI Adapter
 * ==============================================
 * Maps PMM execution contract to KiloCode CLI primitives.
 * Status: planned (stub -- full implementation when KiloCode harness is active)
 */
import type { ExecutionRuntime, AgentSpawner, SkillInvoker, CommandRunner, LifecycleManager } from "../contract";

export class KiloCodeAdapter implements ExecutionRuntime {
  readonly harness = "kilocode";

  agents: AgentSpawner = {
    spawn: async (params) => {
      throw new Error("KiloCode adapter not yet implemented. Use exec inject --harness kilocode to generate.");
    },
  };

  skills: SkillInvoker = {
    invoke: async (params) => {
      throw new Error("KiloCode adapter not yet implemented.");
    },
  };

  commands: CommandRunner = {
    exec: async (params) => {
      // KiloCode supports direct shell execution via terminal()
      throw new Error("KiloCode adapter not yet implemented.");
    },
  };

  lifecycle: LifecycleManager = {
    onSessionStart: (_handler) => {},
    onSessionEnd: (_handler) => {},
    onPreToolUse: (_handler) => {},
    onPostToolUse: (_handler) => {},
    onUserPromptSubmit: (_handler) => {},
  };
}
