<p align="center">
  <img src="https://img.shields.io/badge/bun-%3E%3D1.3.0-%23fbf0df?logo=bun" alt="Bun">
  <img src="https://img.shields.io/npm/v/pmm-ai?color=blue&label=npm" alt="npm">
  <img src="https://img.shields.io/github/license/owenservera/pmm-ai" alt="License MIT">
  <img src="https://img.shields.io/github/stars/owenservera/pmm-ai" alt="Stars">
</p>

<h1 align="center">⚡ PMM-AI</h1>
<p align="center"><strong>Autonomous AI Development Platform</strong></p>
<p align="center">One command. Any AI harness. Complete project intelligence.</p>

---

## What is PMM-AI?

PMM-AI is a **harness-agnostic autonomous development platform**. It gives your AI coding agent persistent project memory, multi-agent swarm orchestration, quality evaluation gates, and cross-session continuity — all from a single SQLite database.

### The Problem

AI coding agents forget everything between sessions. They brute-force file searches. They don't know what was planned, decided, or blocked — especially across different tools.

### The Solution

**One command.** PMM-AI auto-detects your harness, registers 12 skills, configures MCP, sets up lifecycle hooks, and gives your agents structured project intelligence.

```
Without PMM:  Search(pattern: "**/*") → expensive, unstructured, no memory
With PMM:     pmm project get <name> → instant, structured, full history
```

---

## System Overview

```mermaid
flowchart TB
    subgraph Harness["🤖 AI Harness"]
        CC["Claude Code"]
        OC["OpenCode"]
        GC["Gemini CLI"]
        KC["KiloCode"]
        AG["Antigravity"]
    end

    subgraph PMM["⚡ PMM-AI Platform"]
        direction TB
        CLI["🔧 CLI Router\n43 commands"]
        MCP["🔌 MCP Server\n19 tools"]
        Hooks["🪝 Lifecycle Hooks\nSessionStart/Stop"]
        Skills["🎯 12 Skills\nagent, plan, health, swarm..."]

        subgraph Core["🧠 Core Engine"]
            DB["🗄️ SQLite DB\n54 tables · WAL mode"]
            Schema["📐 Schema\nProjects · Milestones\nFeatures · Decisions\nSwarm · Sessions"]
            Auto["🔮 Auto-Derive\nNLP → plan + swarm config"]
        end

        subgraph Tooling["🛠️ Dev Toolchain"]
            Lint["Self-Lint\n95 checks"]
            Shake["Tree-Shake\nDead code"]
            Tokens["Token Budget\nPer agent/model"]
            Profile["Profiler\nLatency · bottlenecks"]
            Cleanup["Cleanup\nOrphan detection"]
            Deps["Dep Graph\nCross-project"]
        end

        subgraph Viz["📊 Visualization"]
            Dashboard["Live Dashboard\nPortfolio · Health · Gantt"]
            Server["HTTP :9998\nAuto-refresh 5s"]
        end
    end

    subgraph Projects["📁 Your Projects"]
        P1["Project A"]
        P2["Project B"]
        P3["Project C"]
    end

    Harness -->|"skills + hooks"| Skills
    Harness -->|"stdio"| MCP
    Harness -->|"JSON config"| Hooks
    Skills --> CLI
    MCP --> DB
    Hooks --> CLI
    CLI --> Core
    Core --> Tooling
    Core --> Viz
    Core -->|"registers & tracks"| Projects

    style PMM fill:#1a1a2e,stroke:#6c63ff,color:#fff
    style Core fill:#16213e,stroke:#0f3460,color:#fff
    style Tooling fill:#16213e,stroke:#e94560,color:#fff
    style Viz fill:#16213e,stroke:#00b894,color:#fff
```

---

## Quick Start

### Interactive First-Run Wizard

On a fresh machine, just run:

```bash
bunx pmm-ai
```

No DB detected? PMM-AI launches an interactive wizard:

```
╔══════════════════════════════════════════╗
║   Welcome to PMM-AI!                     ║
║   Autonomous Development Platform        ║
╚══════════════════════════════════════════╝

  Let's get you set up. I'll ask a few questions.

  Detected claude-code. Use this? [Y/n]

  Where should PMM-AI skills and hooks be installed?
   > [1] Local only — ./.claude/skills/ (for this project)
     [2] Global only — ~/.claude/skills/ (all projects)
     [3] Both — local + global (recommended)
  Pick [3]

  ═══ Configuration Summary ═══
  Harness:       claude-code
  Install scope: both
  DB location:   ~/.pmm-ai/data/pmm.db

  Proceed with setup? [Y/n]
```

```mermaid
flowchart LR
    A["bunx pmm-ai"] --> B{DB exists?}
    B -->|"no"| C["🔮 First-Run Wizard"]
    B -->|"yes"| D["📊 Portfolio Dashboard"]
    C --> E{Harness?}
    E -->|"auto-detect"| F["✅ Confirm"]
    E -->|"manual"| G["🎯 Select from 5"]
    F --> H{Scope?}
    G --> H
    H -->|"local"| I["📁 ./.claude/skills/"]
    H -->|"global"| J["🏠 ~/.claude/skills/"]
    H -->|"both"| K["📁 + 🏠 Both"]
    I --> L["⚡ Setup Complete"]
    J --> L
    K --> L
    L --> D
```

### Setup Flags (Power Users)

```bash
bunx pmm-ai setup               # Interactive (harness selection + scope)
bunx pmm-ai setup --local       # Local only, auto-detect harness
bunx pmm-ai setup --global      # Global only (~/.claude/skills/)
bunx pmm-ai setup --both        # Both local + global
bunx pmm-ai setup --local --no-interactive  # CI/CD friendly
```

### Daily Use

```bash
bunx pmm-ai                    # Portfolio dashboard + live server
bunx pmm-ai start new          # "What are you building?" → auto-plan → swarm config
bunx pmm-ai health             # Portfolio health check
bunx pmm-ai tooling all        # Full platform scan (6 dev tools)
```

---

## Architecture

### Deployment Topology

```mermaid
graph TB
    subgraph UserMachine["🖥️ User Machine"]
        subgraph Global["🏠 Global (~/.pmm-ai/)"]
            GlobalDB["pmm.db\nAll projects"]
            GlobalSkills["~/.claude/skills/\n12 PMM skills"]
        end

        subgraph ProjectA["📁 Project A"]
            LocalSkillsA["./.claude/skills/\n12 PMM skills"]
            LocalMCP[".mcp.json\nPMM server"]
            LocalHooks[".claude/settings.local.json\nSessionStart/Stop hooks"]
        end

        subgraph ProjectB["📁 Project B"]
            LocalSkillsB["./.claude/skills/\n12 PMM skills"]
        end
    end

    GlobalSkills -.->|"global install"| GlobalDB
    LocalSkillsA -->|"local install"| GlobalDB
    LocalSkillsB -->|"local install"| GlobalDB
    LocalMCP -->|"stdio"| GlobalDB
    LocalHooks -->|"lifecycle"| GlobalDB

    style Global fill:#1a1a2e,stroke:#6c63ff,color:#fff
    style GlobalDB fill:#16213e,stroke:#f9ca24,stroke-width:3px,color:#fff
```

### Data Model (Core Tables)

```mermaid
erDiagram
    PROJECTS ||--o{ MILESTONES : "has"
    PROJECTS ||--o{ FEATURES : "has"
    PROJECTS ||--o{ DECISIONS : "records"
    PROJECTS ||--o{ ROADBLOCKS : "blocks"
    PROJECTS ||--o{ TASKS : "tracks"
    PROJECTS ||--o{ SESSIONS : "spans"
    PROJECTS ||--o{ AGENT_LAYERS : "organizes"
    AGENT_LAYERS ||--o{ SWARM_TASKS : "contains"
    SESSIONS ||--o{ SESSION_CAPSULES : "captures"
    TASKS ||--o{ TASK_NOTES : "documents"
    PROJECTS ||--o{ EVALUATOR_GATES : "quality-checks"
    AGENT_LAYERS ||--o{ AGENT_WORKERS : "dispatches"

    PROJECTS {
        int id PK
        string name
        string phase "discover|define|design|build|verify|deploy|maintain"
        string stack
        string health "healthy|attention|blocked"
        string priority "critical|high|medium|low"
        string path
    }
```

### Setup Process Flow

```mermaid
sequenceDiagram
    actor User
    participant CLI as pmm-ai CLI
    participant DB as SQLite DB
    participant FS as File System

    User->>CLI: bunx pmm-ai

    alt First Run (no DB)
        CLI->>CLI: Launch Wizard
        CLI->>User: Welcome + harness selection
        User->>CLI: Confirm harness
        CLI->>User: Scope selection (local/global/both)
        User->>CLI: Choose scope
    else Returning User
        CLI->>DB: Check existing projects
        CLI->>User: Portfolio dashboard
    end

    CLI->>FS: Create ~/.pmm-ai/data/
    CLI->>DB: Initialize schema (54 tables)
    CLI->>FS: Write 12 skills → SKILL.md
    CLI->>FS: Write MCP config → .mcp.json
    CLI->>FS: Write hooks → settings.local.json
    CLI->>DB: Register current project
    CLI->>User: ✅ PMM-AI is ready!
```

### Agent Swarm Execution

```mermaid
flowchart LR
    subgraph Orchestrator["🎯 Orchestrator"]
        Plan["📋 Plan\nMilestones + Features"]
        Dispatch["🚀 Dispatch\nSpawn agents"]
    end

    subgraph Layers["🐝 Agent Layers"]
        L0["L0: Architect\nDesign & plan"]
        L1["L1: Scaffold\nSetup & deps"]
        L2["L2: Core Logic\nAlgorithms"]
        L3["L3: Standards\nCompliance"]
        L4["L4: Implement\nBuild features"]
    end

    subgraph Gates["🚦 Quality Gates"]
        G1["TypeCheck"]
        G2["Build"]
        G3["Test"]
        G4["Lint"]
    end

    Plan --> Dispatch
    Dispatch --> L0
    L0 -->|"design doc"| L1
    L1 -->|"scaffold"| L2
    L2 -->|"core"| L3
    L3 -->|"standards"| L4
    L4 -->|"implementation"| Gates
    Gates -->|"pass"| Done["✅ Complete"]
    Gates -->|"fail"| L4

    style Orchestrator fill:#1a1a2e,stroke:#6c63ff,color:#fff
    style Layers fill:#16213e,stroke:#00b894,color:#fff
    style Gates fill:#16213e,stroke:#e94560,color:#fff
```

---

## Features

### 🧠 Persistent Project Memory
Every session captured. Every decision recorded. Every plan structured. Your agent picks up where it left off — even across different harnesses.

- **Projects**: phase, stack, health, priority, repo path
- **Milestones**: deadline-bound deliverables with acceptance criteria
- **Features**: user-facing capabilities with priorities
- **Decisions**: architectural choices with rationale (ADR-style)
- **Roadblocks**: blockers with severity and resolution tracking
- **Tasks**: atomic work units with notes, methods, evidence, session linking

### 🚀 Multi-Agent Swarm Orchestration
Auto-configured agent layers with RACI roles, parallel tracks, checkin/checkout task pools, and escalation paths. Describe your app → PMM-AI generates the plan and deploys the swarm.

### 🌐 Harness-Agnostic

| Harness | Detected By | Skills | MCP | Hooks |
|---------|------------|--------|-----|-------|
| Claude Code | `.claude/settings.local.json` | 12 skills | 19 tools | SessionStart/Stop |
| OpenCode | `.opencode/` | 12 skills | 19 tools | SessionStart/Stop |
| Gemini CLI | `.gemini/` | 12 skills | 19 tools | SessionStart/Stop |
| KiloCode | `.kilocode/` | 12 skills | 19 tools | SessionStart/Stop |
| Antigravity | `.antigravity/` | 12 skills | 19 tools | SessionStart/Stop |

### 📊 Live Dashboard
Portfolio overview, project health gauges, swarm progress bars, recent activity feed. Auto-refreshes at `http://localhost:9998`. No build step. Single HTML file per project.

### 🔍 Built-In Dev Toolchain
Traditional dev tools, reimagined for AI-assisted development:

| Traditional Tool | PMM-AI Equivalent | Command |
|-----------------|-------------------|---------|
| Tree Shaking | Dead Module Detector | `pmm-ai tooling tree-shake` |
| ESLint | Self-Audit Linter (95 checks) | `pmm-ai tooling lint` |
| Bundle Analyzer | Token Budget Tracker | `pmm-ai tooling tokens` |
| Clinic/Profiler | Agent Performance Tracker | `pmm-ai tooling profile` |
| GC/Leak Detector | Orphan Cleanup | `pmm-ai tooling cleanup` |
| Linker/ld | Cross-Project Dep Graph | `pmm-ai tooling deps` |

### 🎯 Quality Gates
Programmable evaluator gates with defined thresholds, watch mode, and agent-as-judge. Auto-run on session end. 4 consolidation health gates pre-configured.

---

## Source Tree

```
PMM-AI/
├── bin/
│   ├── pmm-ai.cjs               ← npm bin shim (Node CJS → bun)
│   └── pmm.ts                   ← setup entry: wizard, harness detect, install
├── scripts/
│   └── cli.ts                   ← 225-line CLI router (43 commands)
├── src/
│   ├── db.ts                    ← SQLite WAL — single-file DB, zero npm deps
│   ├── schema.ts                ← DDL — 54 tables, indexes, migrations
│   ├── auto-derive.ts           ← NLP → project profile + swarm config
│   ├── events.ts                ← Typed pub/sub event bus (in-process)
│   ├── commands/                ← 10 modules: project, planning, swarm, health...
│   ├── tooling/                 ← 6 modules: tree-shake, self-lint, tokens...
│   ├── visualization/           ← Dashboard: data → HTML generator → live server
│   ├── mcp/server.ts            ← MCP stdio server (19 tools)
│   ├── execution/               ← Harness adapters, swarm deployment, planner
│   └── process/                 ← Environment scanner, artifact bridge
├── state/                       ← Self-referential session state
└── package.json                 ← v1.1.0 · zero dependencies
```

**Key design properties:**
- **Zero npm dependencies** — uses only Bun built-ins + Node stdlib
- **Database at `~/.pmm-ai/data/pmm.db`** — survives npm cache clears, shared across projects
- **Harness-agnostic** — MCP protocol works with any AI tool
- **Interactive + scriptable** — wizard for humans, `--no-interactive` for CI/CD
- **Rust-translatable** — every module exports `Record<string, (db, args) => Promise<void>>`

---

## Commands

### MVP (start here!)
```
pmm-ai start [new|<project>]     Portfolio, wizard, project dashboard
pmm-ai view <project>            HTML project dashboard
pmm-ai health [triage]           Portfolio health check
pmm-ai summary                   Quick counts
```

### Projects & Planning
```
pmm-ai project <register|onboard|discover|list|get|update|delete>
pmm-ai milestone <add|list|update|complete>
pmm-ai feature <add|list|update|complete>
pmm-ai roadblock <add|list|resolve>
pmm-ai decision <add|list|decide|review>
pmm-ai task <add|list|update|complete|log>
```

### Agent & Swarm
```
pmm-ai worker <dispatch|update|list|trace|schedule>
pmm-ai swarm <deploy|visualize|status|export>
pmm-ai layer <list|update>
pmm-ai session <register|close|list|get|name>
```

### Tooling
```
pmm-ai tooling <lint|tree-shake|tokens|profile|cleanup|deps|all>
```

### Advanced
```
pmm-ai wizard <project|milestone|decision|swarm>
pmm-ai evaluator <define|run|list|latest>
pmm-ai standards <check|list>
pmm-ai process scan
pmm-ai mem sync
```

---

## MCP Tools (19 total)

Any MCP-compatible harness can call these directly:

### Read (10)
| Tool | Returns |
|------|---------|
| `pmm_context` | AI-ready context: phase, milestones, decisions, next actions |
| `pmm_project_get` | Full project detail: stack, health, planning data |
| `pmm_project_list` | All projects with filters |
| `pmm_milestone_list` | Milestones with status filter |
| `pmm_feature_list` | Features with status filter |
| `pmm_decision_list` | Architectural decisions |
| `pmm_summary` | Portfolio overview |
| `pmm_health_check` | P0/P1 alerts, staleness, blocks |
| `pmm_dependencies` | Cross-project dependency graph |
| `pmm_process_scan` | Methodologies, artifacts, phase, gaps |

### Write (9)
| Tool | When to Call |
|------|-------------|
| `pmm_session_start` | Session start |
| `pmm_session_end` | Session end |
| `pmm_worker_dispatch` | Before spawning a subagent |
| `pmm_worker_update` | Worker lifecycle changes |
| `pmm_milestone_update` | Milestone status change |
| `pmm_feature_update` | Feature status change |
| `pmm_decision_add` | Architectural decision made |
| `pmm_roadblock_add` | Blocker found |
| `pmm_alert_create` | Alert condition |

---

## Requirements

- [Bun](https://bun.sh) >= 1.3.0
- An AI coding harness (Claude Code, OpenCode, Gemini CLI, KiloCode, or Antigravity)

## Install / Uninstall

```bash
# Interactive (recommended)
bunx pmm-ai setup

# Scripted / CI
bunx pmm-ai setup --local --no-interactive
bunx pmm-ai setup --global --no-interactive
bunx pmm-ai setup --both --no-interactive

# Remove
bunx pmm-ai unregister    # Remove skills, MCP, hooks (data preserved)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome. Check `pmm-ai tooling all` for platform health before submitting.

## License

MIT © [VIVIM](https://vivim.live)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://vivim.live">VIVIM</a></sub><br>
  <sub>Part of the PMM ecosystem — <i>Project Memory that outlives the session</i></sub>
</p>
