/**
 * PMM Interactive Wizards
 * ========================
 * wizard project  — guided project onboarding with confirm steps
 * wizard milestone — phase-aware milestone proposal + selection
 * wizard decision — guided decision recording
 * wizard swarm — interactive swarm setup
 *
 * All wizards call the same DB functions as raw commands, so data is identical.
 * Each wizard step shows the equivalent raw command for learning.
 */
import type { Database } from "bun:sqlite";
import { getProjectId, getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { prompt, confirm, choice, badge, divider, table } from "./shared";
import { discoverProject } from "./discovery";

/** Milestone templates keyed by project phase. */
const MILESTONE_TEMPLATES: Record<string, { name: string; desc: string }[]> = {
  discover: [
    { name: "Problem Statement", desc: "Clear problem definition and user personas identified" },
    { name: "Market Research", desc: "Competitive analysis and opportunity assessment complete" },
    { name: "Technical Feasibility", desc: "Core technology validated with proof-of-concept" },
  ],
  define: [
    { name: "Requirements Spec", desc: "Functional and non-functional requirements documented" },
    { name: "Architecture Design", desc: "System architecture decided and documented (ADRs)" },
    { name: "Schema Design", desc: "Database schema and API contracts finalized" },
  ],
  design: [
    { name: "UI/UX Design", desc: "Wireframes and design system established" },
    { name: "API Design", desc: "API endpoints and data models documented" },
    { name: "Integration Plan", desc: "Third-party integrations identified and scoped" },
  ],
  build: [
    { name: "Alpha Release", desc: "Core functionality working, internal testing" },
    { name: "Beta Release", desc: "External testing, performance validated" },
    { name: "v1.0 Launch", desc: "Production ready, documentation complete" },
  ],
  maintain: [
    { name: "Performance Audit", desc: "Benchmarks established, bottlenecks identified" },
    { name: "Security Review", desc: "Vulnerability scan and dependency audit complete" },
    { name: "Documentation Update", desc: "All docs current and accurate" },
  ],
};

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ wizard:project ═══════════════════════════════════
  "wizard:project": async (db, args) => {
    let repoPath = args[0] || process.cwd();
    console.log(`\n${badge("═══ PMM Project Wizard ═══", "blue")}\n`);

    // Step 1: Discover
    let discovered: any;
    try {
      discovered = discoverProject(repoPath);
    } catch (err: any) {
      console.log(`  Could not discover project at: ${repoPath}`);
      repoPath = await prompt("  Enter project path");
      if (!repoPath) { console.log("  Aborted."); return; }
      discovered = discoverProject(repoPath);
    }

    console.log(`  ${badge("Detected:", "dim")}`);
    console.log(`    Name:   ${discovered.name}`);
    console.log(`    Stack:  ${discovered.tech_stack.join(", ") || "(none)"}`);
    console.log(`    Phase:  ${discovered.phase} (${(discovered.confidence * 100 || 80).toFixed(0)}% confidence)`);
    if (discovered.git_remote) console.log(`    Git:    ${discovered.git_remote} (${discovered.git_branch || "?"})`);
    console.log(`    Commits: ${discovered.git_commits}`);
    if (discovered.warnings?.length) for (const w of discovered.warnings) console.log(`    ⚠ ${w}`);
    console.log("");

    // Step 2: Confirm/override
    const name = await prompt("  [1/4] Project name", discovered.name);
    const phase = await prompt("  [2/4] Phase (discover/define/design/build/maintain)", discovered.phase);
    const priority = await prompt("  [3/4] Priority (critical/high/medium/low)", discovered.priority || "medium");
    const description = await prompt("  [4/4] Description (optional)", discovered.description || "");

    // Check existing
    const existing = queryOne(db, "SELECT id FROM projects WHERE name = ?", [name]);
    if (existing) {
      console.log(`\n  ${badge("⚠ Project already registered", "yellow")}: "${name}"`);
      const update = await confirm("  Update existing project?");
      if (update) {
        run(db, "UPDATE projects SET phase = ?, priority = ?, repo_path = ?, tech_stack = ?, updated_at = datetime('now') WHERE name = ?",
          [phase, priority, repoPath, JSON.stringify(discovered.tech_stack), name]);
        console.log(`\n  ${badge("✓ Updated", "green")}: ${name}`);
      }
      return;
    }

    // Register
    run(db, `INSERT INTO projects (name, status, phase, priority, repo_path, tech_stack, health) VALUES (?, 'active', ?, ?, ?, ?, 'healthy')`,
      [name, phase, priority, repoPath, JSON.stringify(discovered.tech_stack)]);
    const pid = (db.query("SELECT last_insert_rowid() AS id").get() as any).id;
    console.log(`\n  ${badge("✓ Registered", "green")}: ${name} (#${pid}) [${phase}/${priority}]`);

    // Register tools
    if (discovered.tools?.length) {
      const toolStmt = db.prepare("INSERT OR IGNORE INTO tooling (project_id, tool_name, category, priority) VALUES (?, ?, ?, ?)");
      for (const t of discovered.tools) { toolStmt.run(pid, t.name, t.category, t.priority); }
      toolStmt.finalize();
      console.log(`  ${badge(`+ ${discovered.tools.length} tools registered`, "dim")}`);
    }

    console.log(`\n  ${badge("Equivalent command:", "dim")}`);
    console.log(`    bun scripts/cli.ts project onboard ${repoPath} --name "${name}"`);

    // Offer next step
    console.log("");
    const next = await confirm("  Continue to milestone wizard?");
    if (next) {
      await commands["wizard:milestone"]!(db, [name]);
    } else {
      console.log(`\n  Next steps:`);
      console.log(`    bun scripts/cli.ts wizard milestone ${name}`);
      console.log(`    bun scripts/cli.ts project get ${name}`);
      console.log("");
    }
  },

  // ═══ wizard:milestone ═══════════════════════════════════
  "wizard:milestone": async (db, args) => {
    if (!args[0]) { console.log("Usage: bun scripts/cli.ts wizard milestone <project>"); return; }
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    const project = queryOne(db, "SELECT * FROM projects WHERE id = ?", [pid]) as any;
    const phase = project?.phase || "build";

    console.log(`\n${badge(`═══ Milestone Wizard: ${projectName} [${phase} phase] ═══`, "blue")}\n`);

    // Show existing milestones
    const existing = queryAll(db, "SELECT * FROM milestones WHERE project_id = ? ORDER BY due", [pid]) as any[];
    if (existing.length) {
      console.log(`  ${badge("Existing milestones:", "dim")}`);
      for (const m of existing) {
        const icon = m.status === "completed" ? "✓" : m.status === "in-progress" ? "→" : "○";
        console.log(`    ${icon} ${m.name}${m.due ? `  (due: ${m.due})` : ""}  [${m.status}]`);
      }
      console.log("");
    }

    // Propose templates
    const templates = MILESTONE_TEMPLATES[phase] || MILESTONE_TEMPLATES.build!;
    console.log(`  Suggested milestones for '${phase}' phase:`);
    const templateOptions = templates.map((t, i) => ({
      label: `${t.name}  — ${t.desc}`,
      value: t,
    }));
    templateOptions.push({ label: "Skip templates (add custom)", value: { name: "__custom__", desc: "" } });

    const selected = await choice("  Select milestone(s) to add:", templateOptions, true);

    const addedNames: string[] = [];

    for (const template of selected) {
      if (template.name === "__custom__") continue;

      // Check if already exists
      const exists = queryOne(db, "SELECT id FROM milestones WHERE project_id = ? AND name = ?", [pid, template.name]);
      if (exists) {
        console.log(`  ${badge("skip", "dim")} "${template.name}" already exists`);
        continue;
      }

      const due = await prompt(`  Due date for "${template.name}" (YYYY-MM-DD or empty)`);
      const criteria = await prompt(`  Acceptance criteria`, template.desc);

      run(db, `INSERT INTO milestones (project_id, name, due, status, acceptance_criteria) VALUES (?, ?, ?, 'pending', ?)`,
        [pid, template.name, due || null, criteria || null]);
      addedNames.push(template.name);
      console.log(`  ${badge("✓", "green")} Added: ${template.name}`);
    }

    // Custom milestone option
    let addMore = selected.some(s => s.name === "__custom__");
    if (!addMore && selected.length === 0) addMore = true;

    while (addMore) {
      const customName = await prompt("\n  Custom milestone name (empty to finish)");
      if (!customName) break;
      const customDue = await prompt(`  Due date (YYYY-MM-DD or empty)`);
      const customCriteria = await prompt(`  Acceptance criteria`);
      run(db, `INSERT INTO milestones (project_id, name, due, status, acceptance_criteria) VALUES (?, ?, ?, 'pending', ?)`,
        [pid, customName, customDue || null, customCriteria || null]);
      addedNames.push(customName);
      console.log(`  ${badge("✓", "green")} Added: ${customName}`);
    }

    if (addedNames.length) {
      // Show timeline
      const allMilestones = queryAll(db, "SELECT * FROM milestones WHERE project_id = ? ORDER BY due NULLS LAST", [pid]) as any[];
      console.log(`\n  ${badge("Timeline:", "blue")}`);
      divider("", 54);
      for (const m of allMilestones) {
        const icon = m.status === "completed" ? "✓" : "○";
        const duePart = m.due ? m.due : "no date";
        console.log(`    ${icon}  ${duePart.padEnd(12)} ${m.name}  [${m.status}]`);
      }
      console.log(`\n  ${badge(`Added ${addedNames.length} milestone(s)`, "green")}`);
    }

    // Offer decision wizard
    console.log("");
    const next = await confirm("  Continue to decision wizard?");
    if (next) {
      await commands["wizard:decision"]!(db, [projectName]);
    } else {
      console.log(`\n  Next: bun scripts/cli.ts milestone list ${projectName}`);
      console.log("");
    }
  },

  // ═══ wizard:decision ═══════════════════════════════════
  "wizard:decision": async (db, args) => {
    if (!args[0]) { console.log("Usage: bun scripts/cli.ts wizard decision <project>"); return; }
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);

    console.log(`\n${badge(`═══ Decision Wizard: ${projectName} ═══`, "blue")}\n`);

    // Show existing open decisions
    const openDecisions = queryAll(db, "SELECT * FROM decisions WHERE project_id = ? AND status = 'open' ORDER BY created_at", [pid]) as any[];
    if (openDecisions.length) {
      console.log(`  ${badge(`${openDecisions.length} open decision(s):`, "yellow")}`);
      for (const d of openDecisions) {
        console.log(`    #${d.id}  ${d.question}`);
      }
      console.log("");
      const resolve = await confirm("  Resolve open decisions first?");
      if (resolve) {
        for (const d of openDecisions) {
          console.log(`\n  ${badge(`Q: ${d.question}`, "yellow")}`);
          if (d.rationale) console.log(`  ${badge(`Context: ${d.rationale}`, "dim")}`);
          const decision = await prompt("  Decision (empty to skip)");
          if (decision) {
            const rationale = await prompt("  Rationale");
            run(db, "UPDATE decisions SET decision = ?, rationale = COALESCE(?, rationale), status = 'decided' WHERE id = ?",
              [decision, rationale || null, d.id]);
            console.log(`  ${badge("✓", "green")} Decided: ${d.question} → ${decision}`);
          }
        }
      }
    }

    // Add new decisions
    console.log(`\n  ${badge("Record new decisions or open questions:", "blue")}`);
    let addMore = true;
    while (addMore) {
      const question = await prompt("\n  Question (empty to finish)");
      if (!question) break;
      const decision = await prompt("  Decision (empty if undecided)");
      const rationale = await prompt("  Rationale");

      run(db, `INSERT OR REPLACE INTO decisions (project_id, question, decision, rationale, status) VALUES (?, ?, ?, ?, ?)`,
        [pid, question, decision || null, rationale || null, decision ? "decided" : "open"]);
      const status = decision ? badge("decided", "green") : badge("open", "yellow");
      console.log(`  ${badge("✓", "green")} Recorded [${status}]: ${question}`);
      console.log(`  ${badge("Equivalent:", "dim")} bun scripts/cli.ts decision add ${projectName} "${question}" --decision "${decision || "..."}" --rationale "${rationale || "..."}"`);
    }

    console.log(`\n  Review all: bun scripts/cli.ts decision review ${projectName}`);
    console.log("");
  },

  // ═══ wizard:swarm ═══════════════════════════════════════
  "wizard:swarm": async (db, args) => {
    if (!args[0]) { console.log("Usage: bun scripts/cli.ts wizard swarm <project>"); return; }
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);

    console.log(`\n${badge(`═══ Swarm Wizard: ${projectName} ═══`, "blue")}\n`);

    // Check existing swarm
    const existingLayers = queryAll(db, "SELECT * FROM agent_layers WHERE project_id = ? ORDER BY layer_num", [pid]) as any[];
    const existingTasks = (queryOne(db, "SELECT COUNT(*) as c FROM swarm_tasks WHERE project_id = ?", [pid]) as any).c;

    if (existingLayers.length || existingTasks) {
      console.log(`  ${badge("Existing swarm:", "dim")} ${existingLayers.length} layers, ${existingTasks} tasks`);
      for (const l of existingLayers) console.log(`    L${l.layer_num}: ${l.name}`);
      console.log("");
      const cont = await confirm("  Extend existing swarm?", true);
      if (!cont) { console.log("  Aborted."); return; }
    }

    // Step 1: Choose routing code
    const routingOptions = [
      { label: "Code 3: Standard (L0→L4) — most common", value: 3 },
      { label: "Code 1: Quick Fix (L4 only) — single-layer implementation", value: 1 },
      { label: "Code 2: Guided (L0→L1→L4) — arch + scaffold + implement", value: 2 },
      { label: "Code 10: Full Pipeline (L0→L1→L2→L3→L4) — everything", value: 10 },
    ];
    const selectedCodes = await choice("  Select routing code:", routingOptions);
    const routingCode = selectedCodes[0] ?? 3;

    console.log(`\n  ${badge("Initializing swarm...", "blue")}`);

    // Import and use ROUTING_CODES
    const { ROUTING_CODES } = await import("./shared-swarm");
    const rc = ROUTING_CODES[routingCode];
    if (!rc) { console.log(`  Unknown routing code: ${routingCode}`); return; }

    const defaultNames: Record<number, string> = {
      0: "Architecture & Design", 1: "Scaffolding & Dependencies",
      2: "Algorithms & Core Logic", 3: "Research & Standards", 4: "Implementation",
    };
    const neededNums = rc.pipeline.map((p: string) => parseInt(p.replace("L", "")));
    const existingNums = new Set(existingLayers.map((l: any) => l.layer_num));

    for (const ln of neededNums) {
      if (!existingNums.has(ln)) {
        const layerName = await prompt(`  Layer L${ln} name`, defaultNames[ln] || `Layer ${ln}`);
        run(db, `INSERT INTO agent_layers (project_id, layer_num, name) VALUES (?,?,?)`, [pid, ln, layerName]);
        console.log(`  ${badge("✓", "green")} L${ln}: ${layerName}`);
      }
    }

    // Step 2: Add tasks interactively
    console.log(`\n  ${badge("Add swarm tasks:", "blue")}`);
    console.log(`  ${badge("(Tasks are the units of work assigned to AI agents)", "dim")}\n`);

    let taskCount = 0;
    let addTasks = true;
    while (addTasks) {
      const taskName = await prompt("  Task name (empty to finish)");
      if (!taskName) break;

      const layerChoices = neededNums.map(ln => ({
        label: `L${ln}: ${defaultNames[ln] || `Layer ${ln}`}`,
        value: ln,
      }));
      const selectedLayers = await choice("  Assign to layer:", layerChoices);
      const layerNum = selectedLayers[0] ?? neededNums[neededNums.length - 1]!;

      const criteria = await prompt("  Acceptance criteria (optional)");

      run(db, `INSERT INTO swarm_tasks (project_id, layer_num, routing_code, name, acceptance_criteria) VALUES (?,?,?,?,?)`,
        [pid, layerNum, routingCode, taskName, criteria || null]);
      taskCount++;
      console.log(`  ${badge("✓", "green")} Task added: ${taskName} [L${layerNum}]`);
    }

    // Summary
    const totalTasks = (queryOne(db, "SELECT COUNT(*) as c FROM swarm_tasks WHERE project_id = ?", [pid]) as any).c;
    const totalLayers = (queryOne(db, "SELECT COUNT(*) as c FROM agent_layers WHERE project_id = ?", [pid]) as any).c;

    console.log(`\n  ${badge("Swarm configured:", "green")} ${totalLayers} layers, ${totalTasks} tasks`);
    console.log(`\n  Next steps:`);
    console.log(`    bun scripts/cli.ts swarm visualize ${projectName}     # see the task graph`);
    console.log(`    bun scripts/cli.ts swarm deploy ${projectName} --dry-run  # preview execution`);
    console.log(`    bun scripts/cli.ts swarm export ${projectName}        # export handoff manifest`);
    console.log("");
  },

  // ═══ wizard (help) ═══════════════════════════════════
  "wizard": async (db, args) => {
    if (args[0]) {
      // Delegate to wizard:subcommand
      const key = `wizard:${args[0]}`;
      if (commands[key]) {
        await commands[key]!(db, args.slice(1));
        return;
      }
    }
    console.log(`\n${badge("═══ PMM Wizards ═══", "blue")}\n`);
    console.log("  Interactive, guided workflows for common PMM tasks.\n");
    console.log("  Usage: bun scripts/cli.ts wizard <type> [project]\n");
    console.log("  Types:");
    console.log(`    ${badge("project", "green")}    Guided project onboarding (discover → confirm → register)`);
    console.log(`    ${badge("milestone", "green")}  Phase-aware milestone proposal and selection`);
    console.log(`    ${badge("decision", "green")}   Record decisions and resolve open questions`);
    console.log(`    ${badge("swarm", "green")}      Interactive multi-agent swarm setup`);
    console.log("\n  Examples:");
    console.log("    bun scripts/cli.ts wizard project ./my-app");
    console.log("    bun scripts/cli.ts wizard milestone my-project");
    console.log("    bun scripts/cli.ts wizard swarm my-project");
    console.log("");
  },
};
