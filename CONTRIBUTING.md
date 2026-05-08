# Contributing to PMM-AI

Thanks for contributing! PMM-AI is an autonomous development platform — we welcome PRs for bug fixes, new features, harness adapters, and tooling improvements.

## Getting Started

```bash
git clone https://github.com/owenservera/pmm-ai.git
cd pmm-ai
bun install
```

### Run the platform health check

```bash
bun scripts/cli.ts tooling all
```

This runs all 6 dev tools: lint, tree-shake, token budget, profiler, cleanup, and dependency graph.

### Run the test suite

```bash
bun test
```

## Project Structure

```
src/
├── commands/          CLI command handlers (project, planning, swarm, health...)
├── tooling/           Dev tools (tree-shake, self-lint, token-budget, profiler...)
├── visualization/     Dashboard engine (data, generator, server)
├── mcp/               MCP stdio server
├── execution/         Harness adapters, swarm deployment, planner
├── process/           Environment scanner, artifact bridge
├── auto-derive.ts     NLP → project profile + swarm config
├── db.ts / schema.ts  SQLite database layer
└── events.ts          Pub/sub event bus
```

## Development Flow

1. **Check platform health**: `bun scripts/cli.ts tooling all` — fix any regressions first
2. **Add or modify**: follow the module pattern — every command module exports `Record<string, (db, args) => Promise<void>>`
3. **Build check**: `bun build scripts/cli.ts --target bun` — must bundle cleanly
4. **Test**: `bun test`
5. **Lint**: `bun scripts/cli.ts tooling lint` — address critical findings
6. **PR**: include what changed and why. If adding a new command, update `MODULE_MAP` in `scripts/cli.ts`

## Module Pattern

All command modules follow this pattern:

```typescript
import type { Database } from "bun:sqlite";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {
  "command:sub": async (db, args) => { /* ... */ },
  "command": async (db, args) => { /* ... */ },
};
```

- `command:sub` keys match exact subcommands (fast path in router)
- `command` keys are fallback handlers
- First argument is always the SQLite database handle
- Use `queryAll`, `queryOne`, `run` from `../db` — never raw SQLite

## Adding a New Harness Adapter

1. Add detection logic in `bin/pmm.ts` `detectHarness()`
2. Add harness profile to `src/execution/harnesses/registry.json`
3. If needed, add adapter file in `src/execution/adapters/`
4. Test with `bunx pmm-ai setup` against the new harness

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Questions?

Open an issue or start a discussion. We're building the autonomous development platform together.
