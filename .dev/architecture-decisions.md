# Architecture Decisions

> PMM-AI design rationale. Each decision records what we chose, why, and what we rejected.

---

## ADR-001: `cmd:sub` Namespace Format

**Decision:** Command handlers are keyed as `"cmd:sub"` strings (e.g., `"milestone:list"`).

**Why:** Multiple top-level commands map to the same module. `planning.ts` serves
milestone, feature, roadblock, and decision — all four have a `list` subcommand.
Bare `sub` keys would collide. Prefixing with `cmd` eliminates ambiguity.

**Rejected:** Nested map (`commands[cmd][sub]`) — adds indirection without benefit.
The flat map with colon-delimited keys is simpler to type and debug.

---

## ADR-002: DB as Parameter, Never Global

**Decision:** Every handler receives `(db: Database, args: string[])`. No module captures
a DB reference in closure or module scope.

**Why:** This is the single most important decision for Rust translatability. In Rust,
the borrow checker would reject a global mutable DB connection. Passing it as a parameter
maps directly to `fn handle(&self, db: &Database, args: &[String]) -> Result<()>`.

**Rejected:** Module-level `const db = openDb()` — would work in TypeScript but creates
a hard coupling that can't be translated to Rust.

---

## ADR-003: Schema in One File

**Decision:** All `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` patches live in
`src/schema.ts` as `initSchema(db)`.

**Why:**
- **Auditability:** The complete data model is visible in one place
- **Testability:** Can call `initSchema(inMemoryDb)` in tests
- **Fresh installs:** New PMM-AI instances get the full schema on first run
- **Migration parity:** The migration scripts and `schema.ts` must stay in sync —
  centralizing DDL makes drift visible

**Rejected:** DDL scattered across the CLI router and migration scripts (the old approach).

---

## ADR-004: Zero npm Dependencies

**Decision:** PMM-AI uses only Bun built-ins (`bun:sqlite`) and Node.js standard library
(`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:os`).

**Why:** PMM-AI is infrastructure — it must work on any machine with Bun installed
without `npm install`. This eliminates an entire class of supply-chain and versioning
issues.

**Tradeoff:** No CLI argument parsing library. The current ad-hoc `for (let i...)`
flag parsing works but is fragile. A future Rust rewrite would use `clap`.

---

## ADR-005: Harness-Agnostic State Path

**Decision:** Session state files live in `state/` at PMM-AI root, resolved via
`import.meta.dir` (not `process.cwd()`).

**Why:** The old path (`.omc/state/`) coupled PMM to oh-my-claudecode internals.
The new path is self-referential — PMM-AI owns its state directory regardless of
which harness invokes it or which project directory is current.

**Rejected:** `process.cwd()` + project-relative paths — fails when PMM-AI is used
as a library from a different working directory.

---

## ADR-006: Dynamic Module Imports in Router

**Decision:** The CLI router uses `const mod = await import(modulePath)` with a static
`MODULE_MAP` that maps command strings to module paths.

**Why:** Only the requested command's module is loaded. A `bun scripts/cli.ts health`
call loads `health.ts` and its dependencies (~500 lines), not all 7300 lines.

**Rejected:** Static imports at the top of the file — would eagerly load all modules
on every invocation, negating the modularization benefit.

---

## ADR-007: PMM-AI as Standalone Project

**Decision:** PMM-AI lives in its own directory with its own `package.json`, `tsconfig.json`,
`data/`, and `state/`. It is not a subdirectory of TERMINAL or any other project.

**Why:** PMM is the Centralized Nervous System — it orchestrates across ALL projects.
Burying it inside one of the projects it manages (TERMINAL) creates a false hierarchy.
A standalone project correctly reflects its role as infrastructure.

**Migration path:** TERMINAL's `src/pmm/` and `scripts/pmm*.ts` can be replaced with
a symlink or git submodule pointing to PMM-AI. The `PMM/pmm.db` path in TERMINAL's
hooks should point to `PMM-AI/data/pmm.db` or use the MCP server.
