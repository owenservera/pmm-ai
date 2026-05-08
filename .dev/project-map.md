# PMM-AI Project Map

> Quick navigation for agents and developers. Where everything lives and why.

---

## Directory Layout

```
PMM-AI/
├── README.md              ← Agent-facing reference (concepts, tools, protocol)
├── package.json           ← Zero npm deps, scripts: { cli, health, mcp, test, ... }
├── tsconfig.json          ← ESNext, bundler resolution, bun-types
│
├── src/
│   ├── db.ts              ← SQLite connection (openDb), query helpers, generateSessionId
│   ├── schema.ts          ← All DDL: initSchema(db) — tables, indexes, column patches
│   ├── events.ts          ← Typed pub/sub event bus (singleton, wildcard listeners)
│   ├── events.test.ts     ← 12 tests for event bus
│   │
│   ├── commands/          ← CLI command handlers (one module = one or more commands)
│   │   ├── shared.ts          table(), requireArgs(), readBatchInput()
│   │   ├── shared-swarm.ts    ROUTING_CODES, injectWorkerTracking(), manifest builders
│   │   ├── discovery.ts       discoverProject() — auto-detect project metadata from filesystem
│   │   ├── project.ts         project + tool commands
│   │   ├── planning.ts        milestone + feature + roadblock + decision
│   │   ├── tasks.ts           atomic task CRUD with enrichment fields
│   │   ├── portfolio.ts       roadmap + node + product (recursive CTE trees)
│   │   ├── agents.ts          agent registration + worker lifecycle + scheduling
│   │   ├── session.ts         session start/register/close/list/get/name/detect/verify
│   │   ├── health.ts          health + check + doctor (sense → diagnose → heal)
│   │   ├── evaluator.ts       quality gates (define, run, watch, history, report, judge)
│   │   ├── oracle.ts          intelligence (observe, research, brief, ask, graph, propose)
│   │   ├── mem.ts             memory bridge to claude-mem (delegates to pmm-mem-bridge.ts)
│   │   ├── swarm.ts           swarm orchestration + layer definitions + harness exec
│   │   └── ops.ts             config, summary, standards, build, deploy, migrate, process,
│   │                           plan, architect, protocol-align
│   │
│   ├── mcp/
│   │   └── server.ts      ← MCP stdio server — 19 tools (10 read + 9 write)
│   │
│   ├── process/           ← Process awareness scanner
│   │   ├── scan.ts            Detects methodologies, artifacts, phase, gaps
│   │   ├── bridge.ts          Extracts structured data from artifacts
│   │   ├── types.ts           Type definitions
│   │   └── index.ts           Re-exports
│   │
│   ├── execution/         ← Harness adapter system
│   │   ├── contract.ts        TypeScript interfaces for agent spawn/skill invoke/command run
│   │   ├── inject.ts          Generates adapter files for target harnesses
│   │   ├── index.ts           Re-exports
│   │   ├── adapters/          Per-harness adapter implementations
│   │   │   ├── claude-code.ts
│   │   │   ├── opencode.ts
│   │   │   ├── kilocode.ts
│   │   │   └── gemini.ts
│   │   ├── harnesses/         Harness registry + discovery
│   │   │   ├── registry.json      Registered harness profiles
│   │   │   ├── discover.ts        Auto-detect harness from installation path
│   │   │   └── validate.ts        Validate harness profiles
│   │   └── __tests__/         Adapter + contract + inject tests
│   │
│   ├── detection/         ← Intent detection (for auto-routing)
│   │   ├── context.ts
│   │   ├── intents.json
│   │   └── __tests__/
│   │
│   ├── server.ts          ← HTTP/SSE server (:9999)
│   ├── bridge.ts          ← PMM bridge (REST API)
│   ├── automation-api.ts  ← Automation API (:4200)
│   └── protocol-align.ts  ← Protocol alignment scanner
│
├── scripts/              ← Standalone scripts (run via `bun scripts/<name>.ts`)
│   ├── cli.ts                Main CLI entry point (the router)
│   ├── migrate-cns.ts        CNS harness_sessions migration (idempotent)
│   ├── pmm-mem-bridge.ts     Bridge to claude-mem for cross-session memory
│   ├── pmm-oracle-observe.ts Oracle observation pipeline
│   ├── pmm-context-inject.ts AI context block generation
│   ├── pmm-worker-telemetry.ts Worker telemetry collector
│   ├── pmm-tool-health.ts   Tool health scanner
│   ├── pmm-ci-tracker.ts    CI run tracker
│   ├── pmm-evaluator-judge.ts Agent-as-judge evaluation
│   ├── pmm-generate-agents.ts Agent definition generator
│   ├── pmm-spec-bridge.ts   Spec-to-PMM bridge
│   ├── pmm-register-spec-bridge-hook.ts Hook registration
│   ├── cns-register-mcp.ts  MCP registration helper
│   └── cns-sync-rules.ts    CNS rule syncer
│
├── data/
│   └── pmm.db             ← The database (SQLite WAL, auto-created if missing)
│
├── state/                 ← Harness-agnostic session state
│   ├── current-session.json   Active session identity (project, milestone, task, purpose)
│   └── session-protocol.json  Protocol step tracking (continuity, detect, register, ...)
│
└── .dev/                  ← Development documentation (you are here)
    ├── session-handoff.md     What we did, why, what's next
    ├── architecture-decisions.md  ADRs with rationale
    └── project-map.md         This file
```

---

## Key Files by Role

### If you need to...

| Task | Start here |
|------|-----------|
| Understand the data model | `src/schema.ts` |
| Query the database | `src/db.ts` — `openDb()`, `queryAll()`, `queryOne()`, `run()` |
| Add a new CLI command | `src/commands/` — find the right module, add a `"cmd:sub"` handler |
| Add a new MCP tool | `src/mcp/server.ts` — add to `tools` array + `handlers` object |
| Understand swarm orchestration | `src/commands/swarm.ts` + `src/commands/shared-swarm.ts` |
| Understand the event bus | `src/events.ts` |
| Add a harness adapter | `src/execution/adapters/` — follow the existing pattern |
| Understand the router | `scripts/cli.ts` |
| Read agent-facing docs | `README.md` |

---

## Command → Module Mapping

```
project:*       → src/commands/project.ts
tool:*          → src/commands/project.ts
milestone:*     → src/commands/planning.ts
feature:*       → src/commands/planning.ts
roadblock:*     → src/commands/planning.ts
decision:*      → src/commands/planning.ts
task:*          → src/commands/tasks.ts
roadmap:*       → src/commands/portfolio.ts
node:*          → src/commands/portfolio.ts
product:*       → src/commands/portfolio.ts
agent:*         → src/commands/agents.ts
worker:*        → src/commands/agents.ts
session:*       → src/commands/session.ts
health          → src/commands/health.ts
check           → src/commands/health.ts
doctor:*        → src/commands/health.ts
evaluator:*     → src/commands/evaluator.ts
oracle:*        → src/commands/oracle.ts
mem:*           → src/commands/mem.ts
swarm:*         → src/commands/swarm.ts
layer:*         → src/commands/swarm.ts
exec:*          → src/commands/swarm.ts
config:*        → src/commands/ops.ts
summary         → src/commands/ops.ts
standards:*     → src/commands/ops.ts
build:*         → src/commands/ops.ts
deploy:*        → src/commands/ops.ts
migrate:*       → src/commands/ops.ts
process:*       → src/commands/ops.ts
plan            → src/commands/ops.ts
architect:*     → src/commands/ops.ts
protocol-align  → src/commands/ops.ts
```
