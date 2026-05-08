/**
 * PMM Execution Contract — Harness-Agnostic Runtime Interfaces
 *
 * Every PMM agent, skill, and hook codes against these interfaces.
 * Each harness provides one adapter that implements ExecutionRuntime.
 * Phase 1 ships with ClaudeCodeAdapter. Phase 2+ add OpenCode, KiloCode, Gemini, Antigravity.
 */

// ── Agent Spawning ──────────────────────────────────────────

export interface SpawnAgentParams {
  agentType: string; // "pmm-architect", "executor", "pmm-health-scorer", etc.
  model: "haiku" | "sonnet" | "opus";
  prompt: string;
  project?: string; // PMM project name (defaults to TERMINAL)
  workerId?: number; // PMM DB worker ID for lifecycle tracking
  runInBackground?: boolean;
}

export interface AgentHandle {
  readonly workerId: number;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  cancel(): Promise<void>;
  getResult(): Promise<WorkerResult>;
}

export interface WorkerResult {
  status: "completed" | "failed" | "cancelled";
  summary: string;
  output?: unknown;
}

export interface AgentSpawner {
  /** Spawn an agent worker. Maps to harness's native agent/task primitive. */
  spawn(params: SpawnAgentParams): Promise<AgentHandle>;
}

// ── Skill Invocation ────────────────────────────────────────

export interface InvokeSkillParams {
  skillName: string; // "pmm-plan", "pmm-health", etc.
  context?: Record<string, unknown>;
}

export interface SkillResult {
  skillName: string;
  output: string;
  structuredData?: unknown;
}

export interface SkillInvoker {
  /** Invoke a PMM skill. Maps to harness's native skill/command primitive. */
  invoke(params: InvokeSkillParams): Promise<SkillResult>;
}

// ── Command Execution ───────────────────────────────────────

export interface ExecCommandParams {
  command: string;
  cwd?: string;
  timeout?: number; // milliseconds
  background?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  /** Execute a shell command. Maps to harness's native terminal/shell primitive. */
  exec(params: ExecCommandParams): Promise<CommandResult>;
}

// ── Lifecycle Hooks ─────────────────────────────────────────

export interface SessionContext {
  project?: string;
  sessionId?: number;
  startedAt?: string;
}

export interface ToolUseContext {
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface PromptContext {
  prompt: string;
}

export type HookHandler<T = void> = (ctx: T) => Promise<void>;

export interface LifecycleManager {
  onSessionStart(handler: HookHandler<SessionContext>): void;
  onSessionEnd(handler: HookHandler<SessionContext>): void;
  onPreToolUse(handler: HookHandler<ToolUseContext>): void;
  onPostToolUse(handler: HookHandler<ToolUseContext>): void;
  onUserPromptSubmit(handler: HookHandler<PromptContext>): void;
}

// ── Bundled Runtime ─────────────────────────────────────────

export interface ExecutionRuntime {
  agents: AgentSpawner;
  skills: SkillInvoker;
  commands: CommandRunner;
  lifecycle: LifecycleManager;
}
