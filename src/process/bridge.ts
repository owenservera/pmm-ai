// PMM Process Awareness — Artifact Bridge
// ==========================================
// Extracts structured data from methodology artifacts and registers in PMM DB.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, queryAll, queryOne, run } from "../db";
import type {
  BridgeResult, ExtractableProject, ExtractableDecision,
  ExtractableMilestone, ExtractableFeature, ExtractableTask,
  RegistrationResult, MethodologyRecord, ArtifactMapping,
} from "./types";

const WORKSPACE_ROOT = join(import.meta.dir, "..", "..", "..");

// ── Section Parsing ────────────────────────────────────

interface Section {
  level: number;    // 1 = #, 2 = ##, 3 = ###
  title: string;
  content: string;
  subsections: Section[];
}

function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const root: Section[] = [];
  const stack: { section: Section; level: number }[] = [];

  let currentContent: string[] = [];
  let currentTitle = "";
  let currentLevel = 0;

  function flushSection() {
    if (currentLevel === 0) return;
    const section: Section = {
      level: currentLevel,
      title: currentTitle.trim(),
      content: currentContent.join("\n").trim(),
      subsections: [],
    };

    // Pop stack until we find a parent with lower level
    while (stack.length > 0 && stack[stack.length - 1]!.level >= currentLevel) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(section);
    } else {
      stack[stack.length - 1]!.section.subsections.push(section);
    }

    stack.push({ section, level: currentLevel });
    currentContent = [];
  }

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)/);
    if (match) {
      flushSection();
      currentLevel = match[1]!.length;
      currentTitle = match[2]!;
    } else {
      currentContent.push(line);
    }
  }
  flushSection();

  return root;
}

function findSection(sections: Section[], titlePattern: string): Section | null {
  const lower = titlePattern.toLowerCase();
  // Direct match
  for (const s of sections) {
    if (s.title.toLowerCase() === lower) return s;
  }
  // Contains match
  for (const s of sections) {
    if (s.title.toLowerCase().includes(lower)) return s;
  }
  // Search subsections
  for (const s of sections) {
    const found = findSection(s.subsections, titlePattern);
    if (found) return found;
  }
  return null;
}

function findAllSections(sections: Section[], titlePattern: string): Section[] {
  const lower = titlePattern.toLowerCase();
  const results: Section[] = [];
  for (const s of sections) {
    if (s.title.toLowerCase().includes(lower)) results.push(s);
    results.push(...findAllSections(s.subsections, titlePattern));
  }
  return results;
}

// ── Value Extraction ────────────────────────────────────

function extractKeyValue(content: string, key: string): string | null {
  // **Key:** value or **Key**: value
  const match = content.match(new RegExp(`\\*\\*${key}[:\\.]?\\*\\*\\s*(.+)`, "i"));
  return match ? match[1]!.trim() : null;
}

function extractBulletList(content: string): string[] {
  return content
    .split("\n")
    .filter(line => /^\s*[-*•]\s+/.test(line))
    .map(line => line.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean);
}

function extractTableRows(content: string): Array<Record<string, string>> {
  const lines = content.split("\n");
  let headerLine = -1;
  let separatorLine = -1;
  const headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      if (line.includes("---")) {
        separatorLine = i;
      } else if (separatorLine === -1 && headerLine === -1) {
        headerLine = i;
        headers.push(...line.split("|").slice(1, -1).map(h => h.trim().toLowerCase()));
      }
    }
  }

  if (headerLine === -1 || separatorLine !== headerLine + 1) return [];

  const rows: Array<Record<string, string>> = [];
  for (let i = separatorLine + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map(c => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] || ""; });
    rows.push(row);
  }
  return rows;
}

function extractCodeFenceList(content: string): string[] {
  const match = content.match(/```[\w]*\n([\s\S]*?)```/);
  if (!match) return [];
  return match[1]!.split("\n").map(l => l.trim()).filter(Boolean);
}

// ── Project Extraction ──────────────────────────────────

function extractProject(
  sections: Section[],
  mapping: ArtifactMapping,
  artifactPath: string,
): ExtractableProject | null {
  const extracts = mapping.extracts;
  let name: string | null = null;

  // Extract name
  if (extracts.name) {
    if (extracts.name.includes("first # heading")) {
      // Use first h1 or the filename
      const h1 = sections.find(s => s.level === 1);
      if (h1) {
        name = h1.title.replace(/^#\s*/, "");
      }
    }
    if (!name && extracts.name.includes("filename")) {
      // Extract from filename: YYYY-MM-DD-name-design.md → name
      const stem = artifactPath.split("/").pop()?.replace(/\.md$/, "") || "";
      const match = stem.match(/\d{4}-\d{2}-\d{2}-(.+?)(-design)?$/);
      if (match) name = match[1]!.replace(/-/g, " ");
    }
    if (!name && extracts.name.includes("directory name under PMM")) {
      const match = artifactPath.match(/PMM\/(.+?)\/project\.md/);
      if (match) name = match[1]!;
    }
    if (!name) name = artifactPath.split("/").pop()?.replace(/\.md$/, "") || "unknown";
  }

  // Clean up project name: strip spec suffixes like " — Design Spec", " — Design", trailing " Spec"
  if (name) {
    name = name
      .replace(/ — Design Spec$/i, "")
      .replace(/ — Design$/i, "")
      .replace(/ — Design Spec/i, "")
      .replace(/ Design Spec$/i, "")
      .replace(/ Design$/i, "")
      .replace(/ Spec$/i, "")
      .trim();
  }

  // Extract description
  let description: string | null = null;
  if (extracts.description) {
    const sectionName = extracts.description.split(" section")[0]!.replace("## ", "");
    let section = findSection(sections, sectionName);
    // Fallback 1: try ## Overview section
    if (!section) section = findSection(sections, "Overview");
    if (section) {
      const paragraphs = section.content.split("\n\n").filter(p => p.trim() && !p.startsWith("```") && !p.startsWith(">"));
      description = paragraphs.slice(0, 2).join("\n\n").trim();
    }
    // Fallback 2: use first paragraph after the h1 heading
    if (!description) {
      const fullText = sections.map(s => s.title + "\n" + s.content).join("\n");
      const firstH1 = sections.find(s => s.level === 1);
      if (firstH1) {
        // Content between h1 and first ## heading
        const afterH1 = fullText.split(firstH1.title);
        if (afterH1.length > 1) {
          const paraText = afterH1[1]!.split(/^## /m)[0]!.trim();
          const firstPara = paraText.split("\n\n").filter(p => p.trim() && !p.startsWith("```") && !p.startsWith(">"))[0];
          if (firstPara) description = firstPara.trim().slice(0, 300);
        }
      }
    }
  }

  // Extract tech stack
  const techStack: string[] = [];
  if (extracts.tech_stack) {
    const sectionName = extracts.tech_stack.split(" section")[0]!.replace("## ", "");
    const section = findSection(sections, sectionName);
    if (section) {
      const bullets = extractBulletList(section.content);
      if (bullets.length > 0) {
        techStack.push(...bullets);
      } else {
        // Try comma-separated or pipe-separated
        const items = section.content.trim().split(/[,|]/).map(s => s.trim()).filter(Boolean);
        techStack.push(...items.filter(i => !i.startsWith("#") && !i.startsWith("```")));
      }
    }
    // Fallback: scan full text for inline **Tech Stack:** or **Stack:** key-value patterns
    // Handles both "**Tech stack**: value" and "**Technology Stack:** value" formats
    if (techStack.length === 0) {
      const fullText = sections.map(s => s.title + "\n" + s.content).join("\n");
      let inlineMatch = fullText.match(/\*\*Tech(?:nology)? ?Stack\*\*?\s*:\s*(.+)/i);
      if (!inlineMatch) inlineMatch = fullText.match(/\*\*Stack\*\*?\s*:\s*(.+)/i);
      // Also check bullet list items: "- **Tech stack**: value"
      const bulletMatch = fullText.match(/^\s*[-*•]\s+\*\*Tech(?:nology)? ?Stack\*\*?\s*:\s*(.+)$/im);
      if (bulletMatch && !inlineMatch) inlineMatch = bulletMatch;
      if (inlineMatch) {
        const items = inlineMatch[1]!.split(/[,|]/).map(s => s.trim()).filter(Boolean);
        techStack.push(...items);
      }
    }
  }

  // Extract phase
  let phase: string | null = null;
  if (extracts.phase) {
    // Try key-value: **Phase:** define
    const fullText = sections.map(s => s.title + "\n" + s.content).join("\n");
    const phaseMatch = fullText.match(/\*\*Phase:\*\*\s*(\w+)/i);
    if (phaseMatch) {
      const raw = phaseMatch[1]!.toLowerCase();
      phase = raw === "approved" ? "define" : raw === "design" ? "design" : raw === "build" ? "build" : raw;
    } else if (extracts.phase.includes("Status field")) {
      const statusMatch = fullText.match(/\*\*Status:\*\*\s*(\w+)/i) ||
                          fullText.match(/Status:\s*(\w+)/i);
      if (statusMatch) {
        const status = statusMatch[1]!.toLowerCase();
        phase = status === "approved" ? "define" : status;
      }
    }
  }

  // Extract priority
  let priority: string | null = null;
  if (extracts.priority) {
    const fullText = sections.map(s => s.title + "\n" + s.content).join("\n");
    const match = fullText.match(/\*\*Priority:\*\*\s*(\w+)/i);
    if (match) priority = match[1]!.toLowerCase();
  }

  return { name, description, tech_stack: techStack, phase, priority };
}

// ── Decision Extraction ─────────────────────────────────

function extractDecisions(sections: Section[], mapping: ArtifactMapping): ExtractableDecision[] {
  const decisions: ExtractableDecision[] = [];
  const extracts = mapping.extracts;
  if (!extracts.decisions) return decisions;

  const sectionNames = extracts.decisions.split(" or ").map((s: string) =>
    s.replace("## ", "").split(" section")[0]!.split(",")[0]!.trim()
  );

  for (const name of sectionNames) {
    const section = findSection(sections, name);
    if (!section) continue;

    // Try table first
    const rows = extractTableRows(section.content);
    for (const row of rows) {
      const question = row["decision"] || row["id"] || row["question"] || "";
      const decision = row["rationale"] || row["decision"] || "";
      if (question && decision) {
        decisions.push({
          question,
          decision,
          rationale: row["rationale"] || null,
        });
      }
    }

    // Fall back to Q/A pairs
    if (decisions.length === 0) {
      const qaLines = section.content.split(/\n\*\*Q[:\u2013-]/i);
      for (const qa of qaLines) {
        const parts = qa.split(/\*\*(?:Decision|A)[:\u2013-]\*\*/i);
        if (parts.length >= 2) {
          decisions.push({
            question: parts[0]!.trim(),
            decision: parts[1]!.trim(),
            rationale: null,
          });
        }
      }
    }

    // Fall back to bullet points
    if (decisions.length === 0) {
      const bullets = extractBulletList(section.content);
      for (const bullet of bullets) {
        const parts = bullet.split(/\s*[:\u2013-]\s*/);
        if (parts.length >= 2) {
          decisions.push({
            question: parts[0]!.trim(),
            decision: parts.slice(1).join(": ").trim(),
            rationale: null,
          });
        }
      }
    }
  }

  return decisions;
}

// ── Milestone Extraction ────────────────────────────────

function extractMilestones(sections: Section[], mapping: ArtifactMapping): ExtractableMilestone[] {
  const milestones: ExtractableMilestone[] = [];
  const extracts = mapping.extracts;
  if (!extracts.milestones) return milestones;

  const sectionNames = extracts.milestones.split(" or ").map((s: string) =>
    s.replace("## ", "").split(" section")[0]!.trim()
  );

  for (const name of sectionNames) {
    // Find sections matching "Phase" or "Implementation Phasing"
    const phaseSections = findAllSections(sections, name);
    if (phaseSections.length === 0) {
      // Try looking for ### headers under an ## Implementation Phasing section
      const parentSection = findSection(sections, name);
      if (parentSection) {
        for (const sub of parentSection.subsections) {
          milestones.push({
            name: sub.title,
            due: extractKeyValue(sub.content, "due") || extractKeyValue(sub.content, "target"),
            acceptance_criteria: sub.content.split("\n").slice(0, 3).join(" ").trim().slice(0, 200) || null,
          });
        }
      }
    }

    for (const section of phaseSections) {
      // Table format: | Phase | Weeks | Deliverable |
      const rows = extractTableRows(section.content);
      for (const row of rows) {
        const msName = row["phase"] || row["deliverable"] || row["name"] || "";
        if (msName) {
          milestones.push({
            name: msName,
            due: row["weeks"] || row["due"] || null,
            acceptance_criteria: row["deliverable"] || row["description"] || null,
          });
        }
      }

      // Heading format: ### Phase N: Name
      if (milestones.length === 0) {
        for (const sub of section.subsections) {
          if (sub.level >= 3) {
            milestones.push({
              name: sub.title,
              due: null,
              acceptance_criteria: sub.content.split("\n").slice(0, 2).join(" ").trim().slice(0, 200) || null,
            });
          }
        }
      }
    }
  }

  return milestones;
}

// ── Feature Extraction ──────────────────────────────────

function extractFeatures(sections: Section[], mapping: ArtifactMapping): ExtractableFeature[] {
  const features: ExtractableFeature[] = [];
  const extracts = mapping.extracts;
  if (!extracts.features) return features;

  const sectionNames = extracts.features.split(" or ").map((s: string) =>
    s.replace("## ", "").split(" section")[0]!.split(",")[0]!.trim()
  );

  for (const name of sectionNames) {
    const section = findSection(sections, name);
    if (!section) continue;

    // Table format
    const rows = extractTableRows(section.content);
    for (const row of rows) {
      const fName = row["component"] || row["feature"] || row["name"] || "";
      if (fName) {
        features.push({
          name: fName,
          description: row["description"] || row["purpose"] || null,
          priority: row["priority"] || null,
          milestone: row["phase"] || row["milestone"] || null,
        });
      }
    }

    // Bullet list format
    if (features.length === 0) {
      const bullets = extractBulletList(section.content);
      for (const bullet of bullets) {
        features.push({
          name: bullet,
          description: null,
          priority: null,
          milestone: null,
        });
      }
    }
  }

  return features;
}

// ── Dependency Extraction ───────────────────────────────

function extractDependencies(
  sections: Section[],
  mapping: ArtifactMapping,
): { from: string; to: string; description: string | null }[] {
  const deps: { from: string; to: string; description: string | null }[] = [];
  const extracts = mapping.extracts;
  if (!extracts.dependencies) return deps;

  const sectionNames = extracts.dependencies.split(" or ").map((s: string) =>
    s.replace("## ", "").split(" section")[0]!.trim()
  );

  for (const name of sectionNames) {
    const section = findSection(sections, name);
    if (!section) continue;

    // Table format
    const rows = extractTableRows(section.content);
    for (const row of rows) {
      const from = row["project"] || row["from"] || row["depends on"] || "";
      const to = row["relationship"] || row["to"] || row["depended on by"] || "";
      if (from && to) {
        deps.push({ from, to, description: row["description"] || null });
      }
    }

    // Bullet format: **Depends on**: X — Y depends on Z
    if (deps.length === 0) {
      const bullets = extractBulletList(section.content);
      for (const bullet of bullets) {
        const parts = bullet.split(/\s*[:\u2013-]\s*/);
        if (parts.length >= 2) {
          deps.push({ from: parts[0]!.trim(), to: parts[1]!.trim(), description: null });
        }
      }
    }
  }

  return deps;
}

// ── Main Bridge Function ────────────────────────────────

export function bridgeArtifact(
  artifactPath: string,
  methodology: MethodologyRecord,
): BridgeResult {
  const fullPath = join(WORKSPACE_ROOT, artifactPath);
  const warnings: string[] = [];

  // Normalize path separators for cross-platform matching
  const normalizedPath = artifactPath.replace(/\\/g, "/");

  // Determine artifact type
  let artifactType = "unknown";
  for (const [type, mapping] of Object.entries(methodology.artifact_mappings)) {
    for (const pattern of mapping.patterns) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      if (regex.test(normalizedPath)) {
        artifactType = type;
        break;
      }
    }
    if (artifactType !== "unknown") break;
  }

  const mapping = methodology.artifact_mappings[artifactType];
  if (!mapping) {
    return {
      artifact_path: artifactPath,
      artifact_type: artifactType,
      methodology: methodology.name,
      project: null,
      milestones: [],
      features: [],
      tasks: [],
      decisions: [],
      dependencies: [],
      extraction_confidence: 0,
      warnings: [`Unknown artifact type for pattern: ${artifactPath}`],
    };
  }

  // Read and parse
  let markdown: string;
  try {
    markdown = readFileSync(fullPath, "utf-8");
  } catch {
    return {
      artifact_path: artifactPath,
      artifact_type: artifactType,
      methodology: methodology.name,
      project: null,
      milestones: [],
      features: [],
      tasks: [],
      decisions: [],
      dependencies: [],
      extraction_confidence: 0,
      warnings: [`Could not read file: ${fullPath}`],
    };
  }

  const sections = parseSections(markdown);

  // Extract
  const project = mapping.maps_to === "project" ? extractProject(sections, mapping, artifactPath) : null;
  const decisions = extractDecisions(sections, mapping);
  const milestones = extractMilestones(sections, mapping);
  const features = extractFeatures(sections, mapping);
  const deps = extractDependencies(sections, mapping);

  // Calculate confidence
  let confidence = 0;
  if (project && project.name) confidence += 0.4;
  if (project && project.description) confidence += 0.1;
  if (project && project.tech_stack.length > 0) confidence += 0.1;
  if (decisions.length > 0) confidence += 0.15;
  if (milestones.length > 0) confidence += 0.15;
  if (features.length > 0) confidence += 0.1;
  if (confidence === 0) confidence = 0.1;

  if (!project) warnings.push("Could not extract project name");
  if (project && project.tech_stack.length === 0) warnings.push("Could not extract tech stack");

  return {
    artifact_path: artifactPath,
    artifact_type: artifactType,
    methodology: methodology.name,
    project,
    milestones,
    features,
    tasks: [],
    decisions,
    dependencies: deps,
    extraction_confidence: Math.min(confidence, 0.95),
    warnings,
  };
}

// ── PMM Registration Bridge ─────────────────────────────

export function bridgeToPMM(result: BridgeResult): RegistrationResult {
  if (!result.project || !result.project.name) {
    return {
      project_id: 0,
      project_name: "",
      milestones_registered: 0,
      features_registered: 0,
      tasks_registered: 0,
      decisions_registered: 0,
      errors: ["No project data to register"],
    };
  }

  const db = openDb();
  const errors: string[] = [];

  try {
    db.exec("BEGIN");

    // 1. Register project
    let projectId: number;
    const existing = queryOne(db, "SELECT id FROM projects WHERE name = ?", [result.project.name]) as any;
    if (existing) {
      projectId = existing.id;
      // Update if we have new info
      if (result.project.phase || result.project.priority) {
        const sets: string[] = [];
        const vals: any[] = [];
        if (result.project.phase) { sets.push("phase = ?"); vals.push(result.project.phase); }
        if (result.project.priority) { sets.push("priority = ?"); vals.push(result.project.priority); }
        if (result.project.description) { /* projects table doesn't have description */ }
        if (sets.length > 0) {
          vals.push(projectId);
          run(db, `UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, vals);
        }
      }
    } else {
      run(db,
        `INSERT INTO projects (name, status, phase, priority, tech_stack, health)
         VALUES (?, 'active', ?, ?, ?, 'healthy')`,
        [
          result.project.name,
          result.project.phase || "define",
          result.project.priority || "medium",
          JSON.stringify(result.project.tech_stack),
        ],
      );
      projectId = (queryOne(db, "SELECT id FROM projects WHERE name = ?", [result.project.name]) as any).id;
    }

    // 2. Register milestones
    let msCount = 0;
    const msIds: Record<string, number> = {};
    for (const ms of result.milestones) {
      // Check if exists
      const existingMs = queryOne(db,
        "SELECT id FROM milestones WHERE project_id = ? AND name = ?",
        [projectId, ms.name],
      );
      if (!existingMs) {
        const r = db.run(
          "INSERT INTO milestones (project_id, name, due, status, acceptance_criteria) VALUES (?, ?, ?, 'pending', ?)",
          [projectId, ms.name, ms.due, ms.acceptance_criteria],
        );
        msIds[ms.name] = Number(r.lastInsertRowid);
        msCount++;
      } else {
        msIds[ms.name] = (existingMs as any).id;
      }
    }

    // 3. Register features
    let featCount = 0;
    for (const feat of result.features) {
      const msId = feat.milestone ? msIds[feat.milestone] || null : null;
      const existingFeat = queryOne(db,
        "SELECT id FROM features WHERE project_id = ? AND name = ?",
        [projectId, feat.name],
      );
      if (!existingFeat) {
        db.run(
          "INSERT INTO features (project_id, name, status, description, epic_milestone_id, priority) VALUES (?, ?, 'planned', ?, ?, ?)",
          [projectId, feat.name, feat.description, msId, feat.priority || "medium"],
        );
        featCount++;
      }
    }

    // 4. Register decisions
    let decCount = 0;
    for (const dec of result.decisions) {
      const existingDec = queryOne(db,
        "SELECT id FROM decisions WHERE project_id = ? AND question = ?",
        [projectId, dec.question],
      );
      if (!existingDec) {
        db.run(
          "INSERT INTO decisions (project_id, question, decision, rationale, status) VALUES (?, ?, ?, ?, 'decided')",
          [projectId, dec.question, dec.decision, dec.rationale],
        );
        decCount++;
      }
    }

    db.exec("COMMIT");

    return {
      project_id: projectId,
      project_name: result.project.name,
      milestones_registered: msCount,
      features_registered: featCount,
      tasks_registered: 0,
      decisions_registered: decCount,
      errors: [],
    };
  } catch (e: any) {
    try { db.exec("ROLLBACK"); } catch {}
    return {
      project_id: 0,
      project_name: result.project.name || "",
      milestones_registered: 0,
      features_registered: 0,
      tasks_registered: 0,
      decisions_registered: 0,
      errors: [...errors, e.message],
    };
  } finally {
    db.close();
  }
}
