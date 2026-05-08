# PMM-AI — Session Handoff

> **Date:** 2026-05-06
> **Phase:** Build — CNS integration complete, standalone extraction complete
> **Next phase:** Production hardening, harness adapter completion

---

## What We Did

### 1. Modularized the 7302-line Monolith (Track C)

`scripts/pmm.ts` was a single 7302-line file with a giant `switch(cmd)` statement containing
30 top-level commands and 100+ subcommands. Every CLI invocation loaded all 7300 lines.

**After:** 120-line router + 16 focused modules in `src/commands/`.

| Module | Lines | Handlers | Responsibility |
|--------|-------|----------|----------------|
| `shared.ts` | ~30 | — | `table()`, `requireArgs()`, `readBatchInput()` |
| `shared-swarm.ts` | ~160 | — | `ROUTING_CODES`, `injectWorkerTracking()`, handoff manifests |
| `discovery.ts` | ~200 | — | `discoverProject()`, `__prompt()` |
| `project.ts` | ~250 | 14 | project CRUD + tool management |
| `planning.ts` | ~350 | 22 | milestone + feature + roadblock + decision |
| `tasks.ts` | ~190 | 6 | atomic tasks with enrichment fields |
| `portfolio.ts` | ~300 | 17 | roadmap + node + product (recursive CTE) |
| `agents.ts` | ~260 | 12 | agent registration + worker lifecycle |
| `session.ts` | ~200 | 9 | session start-to-close lifecycle |
| `health.ts` | ~450 | 7 | health + check + doctor (3 pillars) |
| `evaluator.ts` | ~300 | 7 | quality gates (define/run/watch/history/report/judge) |
| `oracle.ts` | ~200 | 6 | intelligence (observe/research/brief/ask/graph/propose) |
| `mem.ts` | ~120 | 6 | memory bridge to claude-mem |
| `swarm.ts` | ~400 | 18 | swarm orchestration + layers + harness exec |
| `ops.ts` | ~490 | 22 | config, summary, standards, build, deploy, migrate, process, plan, architect, protocol-align |

**Key design decision: `cmd:sub` key format.** Since `planning.ts` serves four commands
(milestone, feature, roadblock, decision), using bare `sub` keys would collide (e.g., both
have `list`). The `cmd:sub` format (`"milestone:list"`, `"feature:list"`) eliminates ambiguity.

### 2. Completed CNS Integration (Tracks A, B, D)

**Track A — MCP Write Tools:** 9 new tools added to `src/mcp/server.ts` (already done by
parallel agent). Total: 19 tools (10 read + 9 write).

**Track B — Harness Sessions:** Migration created `harness_sessions` table + indexes +
harness columns on `agent_workers` and `sessions`. Added to `schema.ts` for fresh installs.

**Track D — Event Bus:** `src/events.ts` — typed pub/sub singleton with wildcard listeners,
`once()`, and SSE broadcast integration. 12 passing tests.

### 3. Extracted PMM-AI as Standalone Project

PMM was scattered across TERMINAL's `src/pmm/` and `scripts/`. It's now a self-contained
project at `PMM-AI/` with:

- Its own `package.json` (zero npm dependencies — bun built-ins only)
- Its own `tsconfig.json`
- `data/pmm.db` — self-contained database (copied from TERMINAL's PMM/pmm.db)
- `state/` — harness-agnostic session state (replaces `.omc/state/`)
- `src/` — owns its namespace (no more `src/pmm/` nesting)
- `scripts/cli.ts` — standalone entry point

### 4. Removed oh-my-claudecode Coupling

All `.omc/` references replaced with `PMM/state/` → `state/` paths:

| Before (harness-coupled) | After (harness-agnostic) |
|---|---|
| `.omc/state/current-session.json` | `state/current-session.json` |
| `.omc/state/session-protocol.json` | `state/session-protocol.json` |
| `path.join(process.cwd(), ".omc", "state")` | `path.join(import.meta.dir, "..", "..", "state")` |

PMM-AI no longer knows or cares about oh-my-claudecode internals. Any harness can use it.

---

## Why We Did It This Way

### Interface contract for Rust translatability

Every module exports the same shape:
```typescript
export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = { ... };
```

In Rust this becomes:
```rust
trait CommandHandler {
    fn handle(&self, db: &Database, args: &[String]) -> Result<()>;
}
type CommandRegistry = HashMap<&'static str, Box<dyn CommandHandler>>;
```

The DB is always passed as a parameter — no global state, no closures capturing connections.
This maps cleanly to Rust's ownership model.

### Schema in one place

All DDL lives in `src/schema.ts` as `initSchema(db)`. This is:
- **Testable** — can create an in-memory DB and verify schema
- **Reusable** — called by both CLI router and MCP server
- **Auditable** — the data model is visible at a glance (no buried CREATE TABLE statements)

### Dynamic imports for lazy loading

The router uses `const mod = await import(modulePath)` — only the module for the requested
command is loaded, not all 7300 lines. Startup stays fast.

### Grouping rationale

Commands that share DB tables go in the same module:
- `planning.ts` — milestone/feature/roadblock/decision all follow identical CRUD patterns
- `portfolio.ts` — roadmap/node/product all query `portfolio_nodes` with recursive CTEs
- `health.ts` — health → check → doctor form one cohesive pipeline (sense → diagnose → heal)

---

## Current State

| Component | Status |
|-----------|--------|
| CLI (`scripts/cli.ts`) | Working, all 30 commands verified |
| MCP Server (`src/mcp/server.ts`) | Working, 19 tools (10 read + 9 write) |
| Event Bus (`src/events.ts`) | Working, 12 tests passing |
| DB Schema (`src/schema.ts`) | Complete, includes CNS tables + patches |
| Data (`data/pmm.db`) | 38 projects, 30 portfolio nodes, all tables present |
| State (`state/`) | Directory created, session files written at session start |
| TypeScript | Clean on all `src/commands/` and `src/schema.ts` |

---

## What's Next

### P0 — Production Hardening
- [ ] Move `data/pmm.db` path to environment variable (`PMM_DB_PATH`) instead of hardcoded relative
- [ ] Add `--db-path` flag to CLI for explicit DB location
- [ ] Handle DB missing: auto-create on first run
- [ ] Add `bun scripts/cli.ts --version` and `--help` top-level flags

### P1 — Harness Adapters
- [ ] Complete `execution/adapters/` for all harnesses (currently: claude-code, opencode, kilocode, gemini)
- [ ] Add Antigravity adapter
- [ ] Add adapter auto-detection from environment variables

### P2 — MCP Server Enhancements
- [ ] Add SSE transport alongside stdio
- [ ] Add `pmm_subscribe` tool for real-time event stream
- [ ] Add batch tools (`pmm_milestone_batch`, `pmm_feature_batch`)

### P2 — Dashboard
- [ ] Web dashboard for portfolio visualization
- [ ] Worker activity timeline
- [ ] Health heatmap
