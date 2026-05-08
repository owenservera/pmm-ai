#!/usr/bin/env bun
/**
 * PMM Spec Auto-Bridge — PostToolUse Hook
 * ========================================
 * Detects when a spec/plan file was just written and offers to bridge it.
 * Triggered by PostToolUse hook on Write operations.
 *
 * Usage: bun scripts/pmm-spec-bridge.ts [--auto] [--files "path1,path2"]
 *   --auto: auto-register without prompting (confidence >0.8 only)
 *   --files: comma-separated list of recently written files
 */
import { openDb, queryAll, queryOne, run } from "../src/db";

async function main() {
  const args = process.argv.slice(2);
  const autoMode = args.includes("--auto");
  let filesArg = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--files" && args[i + 1]) filesArg = args[++i]!;
  }
  const writtenFiles = filesArg ? filesArg.split(",").map((f) => f.trim()) : [];

  // Quick pre-check: any of the written files match spec/plan patterns?
  const specPatterns = [
    /docs\/superpowers\/specs\/.*-design\.md$/,
    /docs\/specs\/.*\.md$/,
    /PMM\/.*\/project\.md$/,
  ];
  const matchedFiles = writtenFiles.filter((f) =>
    specPatterns.some((p) => p.test(f.replace(/\\/g, "/"))),
  );

  if (!matchedFiles.length) {
    process.exit(0); // Nothing to bridge -- silent exit
  }

  const db = openDb();

  try {
    let anyRegistered = false;

    for (const file of matchedFiles) {
      const normalizedPath = file.replace(/\\/g, "/");

      // Query enabled methodologies
      const methods = queryAll(
        db,
        "SELECT * FROM methodologies WHERE enabled = 1 ORDER BY priority DESC",
      ) as any[];

      let matched = false;

      for (const method of methods) {
        if (matched) break;
        const mappings = JSON.parse(method.artifact_mappings);
        for (const [type, mapping] of Object.entries(mappings)) {
          if (matched) break;
          for (const pattern of (mapping as any).patterns) {
            const regex = new RegExp(
              "^" +
                (pattern as string).replace(/\./g, "\\.").replace(/\*/g, ".*") +
                "$",
            );
            if (regex.test(normalizedPath)) {
              matched = true;

              try {
                const { bridgeArtifact, bridgeToPMM } = await import(
                  "../src/process/bridge"
                );
                const mRecord = {
                  id: method.id,
                  name: method.name,
                  description: method.description,
                  detection_signals: JSON.parse(method.detection_signals),
                  artifact_mappings: JSON.parse(method.artifact_mappings),
                  phase_rules: method.phase_rules
                    ? JSON.parse(method.phase_rules)
                    : null,
                  priority: method.priority,
                  enabled: method.enabled,
                };

                const result = bridgeArtifact(normalizedPath, mRecord);

                if (result.extraction_confidence >= 0.6 && result.project) {
                  if (autoMode && result.extraction_confidence >= 0.8) {
                    // Auto-register without prompting
                    const reg = bridgeToPMM(result);
                    console.log(
                      `[pmm-spec-bridge] Auto-registered: ${reg.project_name} (${reg.milestones_registered} milestones, ${reg.decisions_registered} decisions)`,
                    );
                    anyRegistered = true;
                  } else {
                    // Suggest registration command
                    console.log(
                      `\n[PMM] Spec detected: ${normalizedPath}`,
                    );
                    console.log(
                      `  Project: ${result.project.name} (${(result.extraction_confidence * 100).toFixed(0)}% confidence)`,
                    );
                    console.log(
                      `  Extractable: ${result.milestones.length} milestones, ${result.decisions.length} decisions, ${result.features.length} features`,
                    );
                    console.log(
                      `  To register: bun scripts/pmm.ts process register "${normalizedPath}"`,
                    );
                    if (result.warnings.length) {
                      console.log(
                        `  Warnings: ${result.warnings.join(", ")}`,
                      );
                    }
                  }
                }
              } catch (e: any) {
                // Bridge not available or failed -- skip silently
              }
              break;
            }
          }
        }
      }
    }

    if (anyRegistered) {
      console.log("[pmm-spec-bridge] Done.");
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("[pmm-spec-bridge] Error:", err);
  process.exit(1);
});
