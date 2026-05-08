/**
 * PMM Execution Framework -- Gemini CLI Adapter
 * =============================================
 * Maps PMM execution contract to Gemini CLI primitives.
 * Note: Gemini CLI uses activate_skill() for agent-like operations.
 * Status: planned (stub -- full implementation when Gemini CLI harness is active)
 */
import type { ExecutionRuntime, AgentSpawner, SkillInvoker, CommandRunner, LifecycleManager } from "../contract";

export class GeminiAdapter implements ExecutionRuntime {
  readonly harness = "gemini-cli";

  agents: AgentSpawner = {
    spawn: async (params) => {
      // Gemini CLI doesn't have a native Task() equivalent.
      // Agents are spawned via activate_skill() with agent definitions.
      throw new Error("Gemini adapter not yet implemented. Use exec inject --harness gemini-cli to generate.");
    },
  };

  skills: SkillInvoker = {
    invoke: async (_params) => {
      // Gemini CLI handles skills differently -- skills ARE agents
      throw new Error("Gemini adapter not yet implemented. Skills map to activate_skill() in Gemini.");
    },
  };

  commands: CommandRunner = {
    exec: async (params) => {
      // Maps to shell() in Gemini CLI
      throw new Error("Gemini adapter not yet implemented.");
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
