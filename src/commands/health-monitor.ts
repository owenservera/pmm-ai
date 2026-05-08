/**
 * PMM-AI Health Monitor — Watch Mode
 * ====================================
 * Live polling health dashboard for projects, sessions, roadblocks, and alerts.
 *
 * Usage:
 *   pmm-ai watch             Live polling mode (every 60s, Ctrl+C to stop)
 *   pmm-ai watch --once      One-shot check, exits with code 1 if issues found
 */
import type { Database } from "bun:sqlite";
import { queryAll, queryOne } from "../db";
import { badge, divider } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ watch ═══════════════════════════════════════════
  "watch": async (db, args) => {
    const onceMode = args.includes("--once");

    // Track state between polls to detect changes
    let lastState: {
      healthMap: Record<string, string>;
      roadblockCount: number;
      alertCount: number;
      sessionCount: number;
    } | null = null;

    /**
     * Run a single health check pass.
     * Returns true if any issues were detected.
     */
    async function runCheck(): Promise<boolean> {
      let issuesFound = false;

      // ── Gather data ────────────────────────────────────────────────
      const projects = queryAll(
        db,
        "SELECT name, health, phase FROM projects WHERE status='active' ORDER BY name",
      ) as any[];

      const activeSessionCount = (
        queryOne(db, "SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NULL") as any
      )?.c ?? 0;

      const staleSessions = queryAll(
        db,
        `SELECT p.name, s.id, s.started_at
           FROM sessions s
           JOIN projects p ON s.project_id = p.id
          WHERE s.ended_at IS NULL
            AND s.started_at < datetime('now', '-24 hours')
          ORDER BY s.started_at`,
      ) as any[];

      const activeRoadblocks = queryAll(
        db,
        `SELECT r.id, r.description, r.severity, p.name AS project
           FROM roadblocks r
           JOIN projects p ON r.project_id = p.id
          WHERE r.resolved_at IS NULL
          ORDER BY r.severity DESC, r.created_at`,
      ) as any[];

      const openAlerts = queryAll(
        db,
        `SELECT a.id, a.severity, a.message, p.name AS project
           FROM alerts a
           JOIN projects p ON a.project_id = p.id
          WHERE a.resolved_at IS NULL
          ORDER BY a.severity DESC, a.created_at`,
      ) as any[];

      // ── Build health map for change detection ──────────────────────
      const healthMap: Record<string, string> = {};
      for (const p of projects) {
        healthMap[p.name] = p.health;
      }

      // ── Render report ──────────────────────────────────────────────
      const timestamp = new Date().toLocaleString();
      console.log("");
      console.log(`  ${badge("PMM Health Watch", "blue")}  ${timestamp}`);
      divider("", 54);

      // Projects
      if (projects.length > 0) {
        console.log(`  ${badge("Projects", "blue")}  ${projects.length} active`);
        for (const p of projects) {
          const healthColor =
            p.health === "healthy" ? "green"
            : p.health === "attention" ? "yellow"
            : "red";
          const icon =
            p.health === "healthy" ? badge("✓", "green")
            : p.health === "attention" ? badge("⚠", "yellow")
            : badge("✗", "red");
          console.log(`    ${icon} ${String(p.name).padEnd(22)} ${badge(p.health, healthColor)}`);

          // Detect health regression since last poll
          if (lastState) {
            const prev = lastState.healthMap[p.name];
            if (prev && prev !== p.health && prev === "healthy") {
              console.log(`         ${badge("REGRESSION", "red")}  was ${prev}, now ${p.health}`);
              issuesFound = true;
            }
          }
        }
      } else {
        console.log(`  ${badge("Projects", "dim")}  none registered`);
      }

      // New roadblocks since last check
      if (lastState && activeRoadblocks.length > lastState.roadblockCount) {
        const known = lastState.roadblockCount;
        const newBlocks = activeRoadblocks.slice(known);
        for (const rb of newBlocks) {
          const sevColor = rb.severity === "critical" ? "red" : rb.severity === "high" ? "yellow" : "dim";
          console.log(`    ${badge("NEW ROADBLOCK", "red")} [${badge(rb.severity, sevColor)}] ${rb.project}: ${String(rb.description).slice(0, 80)}`);
          issuesFound = true;
        }
      }

      // New alerts since last check
      if (lastState && openAlerts.length > lastState.alertCount) {
        const known = lastState.alertCount;
        const newAlerts = openAlerts.slice(known);
        for (const a of newAlerts) {
          const sevColor = a.severity === "critical" ? "red" : a.severity === "warning" ? "yellow" : "dim";
          console.log(`    ${badge("NEW ALERT", "yellow")} [${badge(a.severity, sevColor)}] ${a.project}: ${String(a.message).slice(0, 80)}`);
          issuesFound = true;
        }
      }

      // Sessions
      if (activeSessionCount > 0) {
        console.log(`  ${badge("Sessions", "blue")}  ${activeSessionCount} active`);
        if (staleSessions.length > 0) {
          console.log(`    ${badge("STALE", "yellow")}  ${staleSessions.length} session${staleSessions.length !== 1 ? "s" : ""} open >24h`);
          for (const s of staleSessions) {
            const started = String(s.started_at ?? "").slice(0, 16);
            console.log(`      ${s.name} (since ${started})`);
          }
          issuesFound = true;
        }

        // Detect session count increase
        if (lastState && activeSessionCount > lastState.sessionCount) {
          console.log(`    ${badge("NEW SESSION", "green")}  ${activeSessionCount - lastState.sessionCount} session${activeSessionCount - lastState.sessionCount !== 1 ? "s" : ""} started`);
        }
      } else {
        console.log(`  ${badge("Sessions", "dim")}  none active`);
      }

      // Roadblock summary
      if (activeRoadblocks.length > 0) {
        const criticalCount = activeRoadblocks.filter((r: any) => r.severity === "critical").length;
        const highCount = activeRoadblocks.filter((r: any) => r.severity === "high").length;
        let msg = `${activeRoadblocks.length} unresolved`;
        if (criticalCount > 0) msg += `, ${criticalCount} critical`;
        if (highCount > 0) msg += `, ${highCount} high`;
        console.log(`  ${badge("Roadblocks", "yellow")}  ${msg}`);
      }

      // Alert summary
      if (openAlerts.length > 0) {
        const critAlerts = openAlerts.filter((a: any) => a.severity === "critical").length;
        const warnAlerts = openAlerts.filter((a: any) => a.severity === "warning").length;
        let msg = `${openAlerts.length} unresolved`;
        if (critAlerts > 0) msg += `, ${critAlerts} critical`;
        if (warnAlerts > 0) msg += `, ${warnAlerts} warning`;
        console.log(`  ${badge("Alerts", openAlerts.some((a: any) => a.severity === "critical") ? "red" : "yellow")}  ${msg}`);
      }

      // Summary
      const summaryColor = issuesFound ? "red" : "green";
      const summaryIcon = issuesFound ? "!" : "✓";
      console.log(`  ${badge(`${summaryIcon} ${issuesFound ? "Issues detected" : "All clear"}`, summaryColor)}`);
      console.log("");

      // ── Update last state ──────────────────────────────────────────
      lastState = {
        healthMap,
        roadblockCount: activeRoadblocks.length,
        alertCount: openAlerts.length,
        sessionCount: activeSessionCount,
      };

      return issuesFound;
    }

    // ── Run initial check ────────────────────────────────────────────
    const issuesFound = await runCheck();

    if (onceMode) {
      // Exit with code 1 if issues, 0 if clean
      process.exit(issuesFound ? 1 : 0);
    }

    // ── Live polling loop ────────────────────────────────────────────
    console.log(`  ${badge("Watching... Ctrl+C to stop", "dim")}`);
    console.log("");

    const interval = setInterval(async () => {
      try {
        await runCheck();
      } catch (err: any) {
        console.error(`  ${badge("ERROR", "red")} ${err.message}`);
      }
    }, 60_000);

    // Clean shutdown on Ctrl+C
    process.on("SIGINT", () => {
      clearInterval(interval);
      console.log(`\n  ${badge("Watch stopped.", "dim")}`);
      process.exit(0);
    });

    // Keep alive
    await new Promise(() => {});
  },
};
