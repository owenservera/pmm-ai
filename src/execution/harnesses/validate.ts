// Validate harness registry — parseable, all required fields present, valid status values
import registry from "./registry.json";

interface HarnessProfile {
  name: string;
  instruction_file: string;
  config_file: string;
  agent_spawn: string;
  skill_invoke: string;
  command_run: string;
  file_read: string;
  file_write: string;
  adapter_file: string;
  status: "active" | "planned" | "deprecated" | "disabled";
  hook_mechanism: string;
  hook_events: string[];
  notes?: string;
}

const VALID_STATUSES = new Set(["active", "planned", "deprecated", "disabled"]);

const REQUIRED_FIELDS: (keyof HarnessProfile)[] = [
  "name",
  "instruction_file",
  "config_file",
  "agent_spawn",
  "skill_invoke",
  "command_run",
  "file_read",
  "file_write",
  "adapter_file",
  "status",
  "hook_mechanism",
  "hook_events",
];

const errors: string[] = [];

for (const [key, harness] of Object.entries(registry.harnesses)) {
  const profile = harness as Partial<HarnessProfile>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in profile)) {
      errors.push(`Harness "${key}" missing required field "${field}"`);
    }
  }

  if (profile.status && !VALID_STATUSES.has(profile.status)) {
    errors.push(
      `Harness "${key}" has invalid status "${profile.status}" (expected: active, planned, deprecated, disabled)`,
    );
  }

  if (errors.length === 0) {
    console.log(`✓ ${key} (${profile.name}): ${profile.status}`);
  }
}

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`ERROR: ${err}`);
  }
  process.exit(1);
}

console.log(`\n${Object.keys(registry.harnesses).length} harnesses registered.`);
