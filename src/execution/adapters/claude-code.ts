/**
 * Claude Code Adapter — Maps the PMM Execution Contract to Claude Code primitives.
 *
 * Contract Method          → Claude Code Primitive
 * ─────────────────────────────────────────────────
 * agents.spawn()          → Task()
 * skills.invoke()         → Skill()
 * commands.exec()         → Bash()
 * lifecycle.onSession*()  → settings.local.json hooks
 *
 * This adapter is a 1:1 pass-through for Claude Code. Every contract call
 * produces the exact same primitive invocation as the current direct calls.
 * Zero behavior change, zero timing change, zero token change.
 */

import type {
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
} from "../contract";

// ── Worker Tracking Helpers ─────────────────────────────────

/**
 * Build the worker tracking instructions injected into agent prompts.
 * Kept identical to the current pattern in PMM skill docs.
 */
export function buildWorkerPrompt(workerId: number): string {
  return [
    `YOUR PMM WORKER ID IS #${workerId}.`,
    `Run 'bun scripts/pmm.ts worker update ${workerId} --status running --started'.`,
    `On completion run 'bun scripts/pmm.ts worker update ${workerId} --status completed --result "..."'.`,
    `On failure run 'bun scripts/pmm.ts worker update ${workerId} --status failed --result "..."'.`,
  ].join("\n");
}

/**
 * Inject worker tracking instructions into an agent prompt if a workerId is provided.
 */
export function injectWorkerTracking(prompt: string, workerId?: number): string {
  if (!workerId) return prompt;
  return `${prompt}\n\n${buildWorkerPrompt(workerId)}`;
}

// ── Contract Mapping Documentation ──────────────────────────

/**
 * Claude Code Contract Mapping
 *
 * When an LLM reads PMM agent/skill documentation that references
 * runtime.agents.spawn(), it resolves to the Claude Code tools:
 *
 *   runtime.agents.spawn({agentType, model, prompt, workerId})
 *     → Task({subagent_type: agentType, model, prompt, ...})
 *
 *   runtime.skills.invoke({skillName})
 *     → Skill({skill: skillName})
 *
 *   runtime.commands.exec({command, timeout, background})
 *     → Bash({command, timeout, run_in_background: background})
 *
 *   runtime.lifecycle.onSessionStart(handler)
 *     → Add handler command to .claude/settings.local.json SessionStart hooks
 */
export const CLAUDE_CODE_MAPPING = {
  agents: {
    spawn: "Task({ subagent_type, model, prompt, run_in_background })",
    description:
      "Spawn a subagent using Claude Code's Task tool. Worker tracking instructions are auto-injected when workerId is provided.",
  },
  skills: {
    invoke: "Skill({ skill })",
    description:
      "Invoke a PMM skill using Claude Code's Skill tool. The skill's SKILL.md is loaded into context.",
  },
  commands: {
    exec: "Bash({ command, description, run_in_background, timeout })",
    description:
      "Run a shell command using Claude Code's Bash tool. Set run_in_background: true for long-running commands.",
  },
  lifecycle: {
    register: "settings.local.json hooks array",
    description:
      "Hooks are registered in .claude/settings.local.json under the hooks key. Each hook event maps to a command array in the config.",
  },
} as const;

// ── Adapter Implementation ──────────────────────────────────

/**
 * ClaudeCodeAdapter — the Phase 1 execution runtime.
 *
 * In Claude Code, execution is LLM-mediated: the adapter provides the
 * documentation mapping that tells the LLM how to translate contract
 * methods into Claude Code tool calls. The helper functions (buildWorkerPrompt,
 * injectWorkerTracking) are used by the PMM CLI and skill docs to construct
 * prompts that include worker lifecycle tracking.
 *
 * This class serves primarily as:
 * 1. Documentation of the contract→Claude Code mapping
 * 2. A factory for constructing properly-formatted agent prompts
 * 3. The reference implementation that future harness adapters follow
 */
export class ClaudeCodeAdapter implements ExecutionRuntime {
  readonly harness = "claude-code";
  readonly mapping = CLAUDE_CODE_MAPPING;

  agents: AgentSpawner = {
    spawn: async (params: SpawnAgentParams): Promise<AgentHandle> => {
      // In Claude Code: Task({ subagent_type: params.agentType, model: params.model,
      //   prompt: injectWorkerTracking(params.prompt, params.workerId), ... })
      // Execution is LLM-mediated — this method documents the expected call shape.
      return {
        workerId: params.workerId ?? -1,
        status: "pending",
        cancel: async () => {
          /* Cancel not supported in Claude Code Task() */
        },
        getResult: async (): Promise<WorkerResult> => ({
          status: "completed",
          summary: "Agent execution is LLM-mediated — result returned in-session.",
        }),
      };
    },
  };

  skills: SkillInvoker = {
    invoke: async (params: InvokeSkillParams): Promise<SkillResult> => {
      // In Claude Code: Skill({ skill: params.skillName })
      return {
        skillName: params.skillName,
        output: "Skill invocation is LLM-mediated — output returned in-session.",
      };
    },
  };

  commands: CommandRunner = {
    exec: async (_params: ExecCommandParams): Promise<CommandResult> => {
      // In Claude Code: Bash({ command: params.command, ... })
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    },
  };

  lifecycle: LifecycleManager = {
    onSessionStart: (_handler) => {
      // In Claude Code: add command to .claude/settings.local.json → hooks.SessionStart
    },
    onSessionEnd: (_handler) => {
      // In Claude Code: add command to .claude/settings.local.json → hooks.Stop
    },
    onPreToolUse: (_handler) => {
      // In Claude Code: add command to .claude/settings.local.json → hooks.PreToolUse
    },
    onPostToolUse: (_handler) => {
      // In Claude Code: add command to .claude/settings.local.json → hooks.PostToolUse
    },
    onUserPromptSubmit: (_handler) => {
      // In Claude Code: add command to .claude/settings.local.json → hooks.UserPromptSubmit
    },
  };
}

/** Singleton instance for Phase 1 — always Claude Code. */
export const runtime: ExecutionRuntime = new ClaudeCodeAdapter();
