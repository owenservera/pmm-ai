/**
 * PMM CLI Shared Utilities
 * =========================
 * table(), requireArgs(), readBatchInput() — output formatting, input validation,
 * and interactive prompt helpers used across all command modules.
 *
 * Rust-translatable: formatting/validation functions are pure; prompt helpers
 * wrap platform stdin and would become a separate TTY adapter.
 */
import type { Database } from "bun:sqlite";

/** Render a formatted table to stdout. */
export function table(headers: string[], rows: any[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const sep = "│ " + widths.map((w) => "─".repeat(w)).join(" ┼ ");
  const header = "│ " + headers.map((h, i) => h.padEnd(widths[i]!)).join(" │ ");
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log("│ " + row.map((v, i) => String(v ?? "").padEnd(widths[i]!)).join(" │ "));
  }
}

/** Assert minimum argument count; print usage and exit on failure. */
export function requireArgs(count: number, usage: string, cmd: string, sub: string, args: string[]): void {
  if (args.length < count) {
    console.log(`Usage: bun scripts/pmm.ts ${cmd} ${sub} ${usage}`);
    process.exit(1);
  }
}

/**
 * Read batch input from --json '<array>' or --stdin.
 * Returns parsed array of objects.
 */
export function readBatchInput(args: string[]): any[] {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json" && args[i + 1]) {
      const result = JSON.parse(args[++i]!);
      if (!Array.isArray(result)) {
        console.log("Error: --json value must be a JSON array");
        process.exit(1);
      }
      return result;
    }
    if (args[i] === "--stdin") {
      const fs = require("node:fs");
      const buf = fs.readFileSync(0, "utf-8");
      const result = JSON.parse(buf);
      if (!Array.isArray(result)) {
        console.log("Error: --stdin input must be a JSON array");
        process.exit(1);
      }
      return result;
    }
  }
  console.log("Error: --json '<array>' or --stdin required for batch input");
  process.exit(1);
}

// ─── Interactive prompt helpers ───────────────────────────────────────────────

/**
 * Prompt the user for a single line of input.
 * Returns `defaultVal` if the user presses Enter with no input.
 * Returns `defaultVal` immediately when stdin is not a TTY (CI / pipe mode).
 */
export async function prompt(question: string, defaultVal = ""): Promise<string> {
  if (!process.stdin.isTTY) return defaultVal;
  process.stdout.write(defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `);
  for await (const line of console) {
    return line.trim() || defaultVal;
  }
  return defaultVal;
}

/**
 * Ask a yes/no question. Returns `true` for y/Y/yes, `false` otherwise.
 * Defaults to `false` in non-TTY mode unless `defaultYes` is set.
 */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  process.stdout.write(`${question} ${hint}: `);
  for await (const line of console) {
    const v = line.trim().toLowerCase();
    if (!v) return defaultYes;
    return v === "y" || v === "yes";
  }
  return defaultYes;
}

/**
 * Present a numbered list and return the selected value.
 * Accepts a single number or comma-separated numbers for multi-select.
 * `multiple` controls whether multi-selection is allowed.
 */
export async function choice<T>(
  question: string,
  options: { label: string; value: T }[],
  multiple = false,
): Promise<T[]> {
  console.log(`\n${question}`);
  options.forEach((o, i) => console.log(`  [${i + 1}] ${o.label}`));
  const hint = multiple ? "comma-separated numbers, or 'all'" : "number";
  process.stdout.write(`Select (${hint}): `);
  if (!process.stdin.isTTY) return [];
  for await (const line of console) {
    const v = line.trim();
    if (v === "all" && multiple) return options.map((o) => o.value);
    const indices = v.split(",").map((s) => parseInt(s.trim()) - 1).filter((n) => n >= 0 && n < options.length);
    return indices.map((i) => options[i]!.value);
  }
  return [];
}

// ─── Terminal formatting helpers ──────────────────────────────────────────────

/** Render a horizontal divider with optional label. */
export function divider(label = "", width = 60): void {
  if (label) {
    const pad = Math.max(0, width - label.length - 2);
    console.log(`  ${label} ${"─".repeat(pad)}`);
  } else {
    console.log("  " + "─".repeat(width));
  }
}

/** Render a simple bordered box around multi-line content. */
export function box(lines: string[], title = ""): void {
  const maxLen = Math.max(title.length, ...lines.map((l) => l.length));
  const width = maxLen + 4;
  console.log("  ┌" + (title ? ` ${title} ` + "─".repeat(Math.max(0, width - title.length - 3)) : "─".repeat(width)) + "┐");
  for (const line of lines) {
    console.log(`  │ ${line.padEnd(maxLen)} │`);
  }
  console.log("  └" + "─".repeat(width) + "┘");
}

/** Return a colored status badge string using ANSI codes (gracefully degrades). */
export function badge(label: string, level: "green" | "yellow" | "red" | "blue" | "dim"): string {
  const codes: Record<string, string> = {
    green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", blue: "\x1b[34m", dim: "\x1b[2m",
  };
  const reset = "\x1b[0m";
  return `${codes[level] ?? ""}${label}${reset}`;
}

/** Return a health icon for a given status string. */
export function healthIcon(status: string): string {
  if (status === "healthy" || status === "completed" || status === "done") return "✓";
  if (status === "attention" || status === "at_risk") return "⚠";
  if (status === "blocked" || status === "critical" || status === "failed") return "✗";
  if (status === "running" || status === "in_progress") return "→";
  return "○";
}
