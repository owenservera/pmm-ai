/**
 * PMM Execution Framework -- Harness Auto-Discovery Engine
 *
 * Reads a harness installation directory and auto-detects its execution
 * primitives by inspecting package.json, config files, and documentation.
 *
 * Returns a DiscoverResult even on failure -- never throws.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// -- Types -------------------------------------------------------------------

export interface HarnessProfile {
  name: string;
  instruction_file: string;
  config_file: string;
  agent_spawn: string;
  skill_invoke: string;
  command_run: string;
  file_read: string;
  file_write: string;
  hook_mechanism: string;
  hook_events: string[];
  adapter_file: string;
  status: "active" | "planned" | "deprecated" | "disabled";
  notes?: string;
}

export interface DiscoverResult {
  harnessName: string;
  confidence: number;
  profile: Partial<HarnessProfile>;
  warnings: string[];
}

interface PrimitiveDetection {
  name: string;
  confidence: number;
}

// Fields that count toward the confidence score (matches validate.ts REQUIRED_FIELDS)
const CONFIDENCE_FIELDS: (keyof HarnessProfile)[] = [
  "name",
  "instruction_file",
  "config_file",
  "agent_spawn",
  "skill_invoke",
  "command_run",
  "file_read",
  "file_write",
  "hook_mechanism",
  "hook_events",
  "adapter_file",
  "status",
];

// -- Main Entry Point --------------------------------------------------------

export function discoverHarness(harnessPath: string): DiscoverResult {
  const warnings: string[] = [];
  const profile: Partial<HarnessProfile> = {};

  if (!fs.existsSync(harnessPath)) {
    return {
      harnessName: path.basename(harnessPath),
      confidence: 0,
      profile: {},
      warnings: [`Harness path does not exist: ${harnessPath}`],
    };
  }

  // 1. Harness name -- from package.json `name` or directory name
  profile.name = detectHarnessName(harnessPath);

  // 2. Instruction file -- look for known file names
  profile.instruction_file = detectInstructionFile(harnessPath);

  // 3. Config file + hook events
  const configInfo = detectConfig(harnessPath, profile.name);
  if (configInfo) {
    profile.config_file = configInfo.configFile;
    profile.hook_mechanism = configInfo.hookMechanism;
    profile.hook_events = configInfo.hookEvents;
  }

  // 4. Collect documentation content for primitive detection
  const docContent = collectDocContent(harnessPath);

  // 5. Detect execution primitives from documentation
  const agentSpawn = detectAgentSpawn(docContent);
  if (agentSpawn) {
    profile.agent_spawn = agentSpawn.name;
  }

  const skillInvoke = detectSkillInvoke(docContent);
  if (skillInvoke) {
    profile.skill_invoke = skillInvoke.name;
  }

  const commandRun = detectCommandRun(docContent);
  if (commandRun) {
    profile.command_run = commandRun.name;
  }

  const fileRead = detectFileRead(docContent);
  if (fileRead) {
    profile.file_read = fileRead.name;
  }

  const fileWrite = detectFileWrite(docContent);
  if (fileWrite) {
    profile.file_write = fileWrite.name;
  }

  // 6. Calculate confidence -- proportion of HarnessProfile fields detected
  const confidence = calculateConfidence(profile);

  // 7. Check threshold
  if (confidence < 0.5) {
    warnings.push(
      "Auto-detection confidence below threshold. " +
        "Recommend spawning pmm-harness-onboarder agent for deep discovery.",
    );
  }

  return {
    harnessName: profile.name,
    confidence,
    profile,
    warnings,
  };
}

// -- Name Detection ----------------------------------------------------------

function detectHarnessName(harnessPath: string): string {
  const pkgPath = path.join(harnessPath, "package.json");
  try {
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg.name && typeof pkg.name === "string" && pkg.name.trim().length > 0) {
        return pkg.name.trim();
      }
    }
  } catch {
    // Fall through to directory name
  }
  return path.basename(harnessPath);
}

// -- Instruction File Detection ----------------------------------------------

const INSTRUCTION_CANDIDATES = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "INSTRUCTIONS.md",
  ".harness/instructions.md",
];

function detectInstructionFile(harnessPath: string): string | undefined {
  for (const candidate of INSTRUCTION_CANDIDATES) {
    const fullPath = path.join(harnessPath, candidate);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return candidate;
      }
    } catch {}
  }
  return undefined;
}

// -- Config File + Hook Detection --------------------------------------------

interface ConfigInfo {
  configFile: string;
  hookMechanism: string;
  hookEvents: string[];
}

function detectConfig(harnessPath: string, harnessName: string): ConfigInfo | undefined {
  // Build candidate list
  const candidates: string[] = [
    `${harnessName}.json`,
    `.${harnessName}/settings.local.json`,
    `.config/settings.json`,
  ];

  // Add any .json files with "config" or "settings" in their name
  try {
    const entries = fs.readdirSync(harnessPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        const lower = entry.name.toLowerCase();
        if (
          (lower.includes("config") || lower.includes("settings")) &&
          !candidates.includes(entry.name)
        ) {
          candidates.push(entry.name);
        }
      }
    }
  } catch {
    // Ignore readdir errors
  }

  // Try each candidate
  for (const candidate of candidates) {
    const fullPath = path.join(harnessPath, candidate);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const raw = fs.readFileSync(fullPath, "utf-8");
        const content = JSON.parse(raw);
        const hookKey = findHookKey(content);
        const hookEvents = extractHookEvents(content);

        return {
          configFile: candidate,
          hookMechanism: hookKey ? `${candidate} ${hookKey}` : candidate,
          hookEvents,
        };
      }
    } catch {}
  }

  return undefined;
}

const HOOK_KEYS = ["hooks", "events", "triggers", "lifecycle"];

function findHookKey(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const record = obj as Record<string, unknown>;

  for (const key of HOOK_KEYS) {
    if (key in record && record[key] && typeof record[key] === "object") {
      return key;
    }
  }

  // Recurse into standard nesting keys
  for (const nestKey of ["config", "settings"]) {
    if (nestKey in record && record[nestKey] && typeof record[nestKey] === "object") {
      return findHookKey(record[nestKey]);
    }
  }

  return undefined;
}

function extractHookEvents(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const record = obj as Record<string, unknown>;

  for (const key of HOOK_KEYS) {
    const section = record[key];
    if (section && typeof section === "object" && !Array.isArray(section)) {
      return Object.keys(section as Record<string, unknown>).sort();
    }
  }

  // Recurse into standard nesting keys
  for (const nestKey of ["config", "settings"]) {
    const nested = record[nestKey];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return extractHookEvents(nested);
    }
  }

  return [];
}

// -- Documentation Content Collection ----------------------------------------

const DOC_CANDIDATES = ["README.md", "docs/tools.md", "AGENTS.md"];

function collectDocContent(harnessPath: string): string {
  let content = "";
  for (const candidate of DOC_CANDIDATES) {
    const fullPath = path.join(harnessPath, candidate);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        // biome-ignore lint/style/useTemplate: concatenation is clear and simple here
        content += fs.readFileSync(fullPath, "utf-8") + "\n";
      }
    } catch {}
  }
  return content;
}

// -- Primitive Detection -- Agent Spawn --------------------------------------

function detectAgentSpawn(content: string): PrimitiveDetection | null {
  if (!content) return null;

  // 1.0 -- exact function signature
  const funcMatch = content.match(/function\s+(task|agent|spawn|delegate)\s*\(/i);
  if (funcMatch) {
    return { name: funcMatch[1].toLowerCase(), confidence: 1.0 };
  }

  // 0.7 -- tool name reference with call parentheses
  const toolMatch = content.match(/(?:^|\s|-|\*|,)(Task|Agent|Spawn)\s*\(/);
  if (toolMatch) {
    return { name: toolMatch[1], confidence: 0.7 };
  }

  return null;
}

// -- Primitive Detection -- Skill Invoke -------------------------------------

function detectSkillInvoke(content: string): PrimitiveDetection | null {
  if (!content) return null;

  // 1.0 -- exact function signature
  const funcMatch = content.match(/function\s+(skill|invoke|activate)\s*\(/i);
  if (funcMatch) {
    return { name: funcMatch[1].toLowerCase(), confidence: 1.0 };
  }

  // 0.7 -- tool name reference
  const toolMatch = content.match(/(?:^|\s|-|\*|,)(Skill|Invoke|InvokeSkill|ActivateSkill)\s*\(/);
  if (toolMatch) {
    return { name: toolMatch[1], confidence: 0.7 };
  }

  return null;
}

// -- Primitive Detection -- Command Run --------------------------------------

function detectCommandRun(content: string): PrimitiveDetection | null {
  if (!content) return null;

  // 1.0 -- exact function signature
  const funcMatch = content.match(/function\s+(bash|terminal|shell|exec|run)\s*\(/i);
  if (funcMatch) {
    return { name: funcMatch[1].toLowerCase(), confidence: 1.0 };
  }

  // 0.7 -- tool name reference
  const toolMatch = content.match(/(?:^|\s|-|\*|,)(Bash|Terminal|Shell|Exec)\s*\(/);
  if (toolMatch) {
    return { name: toolMatch[1], confidence: 0.7 };
  }

  return null;
}

// -- Primitive Detection -- File Read ----------------------------------------

function detectFileRead(content: string): PrimitiveDetection | null {
  if (!content) return null;

  // 1.0 -- exact function signature
  const funcMatch = content.match(/function\s+read\s*\(/i);
  if (funcMatch) {
    return { name: "read", confidence: 1.0 };
  }

  // 0.7 -- tool name reference
  const toolMatch = content.match(/(?:^|\s|-|\*|,)Read\s*\(/);
  if (toolMatch) {
    return { name: "Read", confidence: 0.7 };
  }

  return null;
}

// -- Primitive Detection -- File Write ---------------------------------------

function detectFileWrite(content: string): PrimitiveDetection | null {
  if (!content) return null;

  // 1.0 -- exact function signature
  const funcMatch = content.match(/function\s+write\s*\(/i);
  if (funcMatch) {
    return { name: "write", confidence: 1.0 };
  }

  // 0.7 -- tool name reference
  const toolMatch = content.match(/(?:^|\s|-|\*|,)Write\s*\(/);
  if (toolMatch) {
    return { name: "Write", confidence: 0.7 };
  }

  return null;
}

// -- Confidence Calculation --------------------------------------------------

function calculateConfidence(profile: Partial<HarnessProfile>): number {
  let detectedCount = 0;
  for (const field of CONFIDENCE_FIELDS) {
    const value = profile[field];
    if (value === undefined || value === null) continue;
    // Empty arrays count as not-detected
    if (Array.isArray(value) && value.length === 0) continue;
    detectedCount++;
  }
  return Math.round((detectedCount / CONFIDENCE_FIELDS.length) * 100) / 100;
}
