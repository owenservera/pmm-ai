/**
 * PMM Protocol Alignment Scanner
 * ================================
 * Project-agnostic tool that detects protocol mismatches between components
 * in any codebase. Scans source files for protocol patterns (emit/send/on/listen
 * calls) and cross-references them to find gaps.
 *
 * Usage:
 *   import { scanProtocolAlignment } from "./protocol-align";
 *   const result = scanProtocolAlignment("/path/to/project", config);
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternRule {
  /** Human-readable name, e.g. "emit", "on", "get", "post" */
  name: string;
  /** Regex to match the pattern in source code */
  regex: string;
  /** Which regex capture group extracts the channel/route name (0 for no capture, just detection) */
  captureGroup: number;
}

export interface ProtocolConfig {
  /** Protocol name, e.g. "socket.io", "rest", "websocket", "grpc" */
  name: string;
  /** Patterns for how clients send messages */
  clientPatterns: PatternRule[];
  /** Patterns for how servers receive messages */
  serverPatterns: PatternRule[];
  /** Optional patterns for how responses flow back */
  responsePatterns?: PatternRule[];
}

export interface ChannelHit {
  channel: string;
  file: string;
  line: number;
  patternName: string;
  side: "client" | "server" | "response";
}

export type GapSeverity = "critical" | "warning" | "info";
export type GapType =
  | "unmatched_send"
  | "unmatched_receive"
  | "response_mismatch"
  | "channel_mismatch";

export interface ProtocolGap {
  severity: GapSeverity;
  type: GapType;
  clientFile: string;
  clientLine: number;
  serverFile?: string;
  serverLine?: number;
  clientChannel: string;
  serverChannel?: string;
  description: string;
}

export interface ProtocolScanResult {
  projectPath: string;
  protocol: string;
  hits: ChannelHit[];
  clientChannels: string[];
  serverChannels: string[];
  gaps: ProtocolGap[];
  matched: number;
  unmatched: number;
  /** Total files scanned */
  filesScanned: number;
}

// ---------------------------------------------------------------------------
// Default config lookup
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(import.meta.dir, "protocol-configs");

const BUILT_IN_CONFIGS: Record<string, string> = {
  "socket.io": join(CONFIG_DIR, "socket-io.json"),
  rest: join(CONFIG_DIR, "rest.json"),
  websocket: join(CONFIG_DIR, "websocket.json"),
};

/**
 * Load a protocol config by name from the built-in configs directory.
 * Falls back to loading from a custom file path if name ends with `.json`.
 */
export function loadProtocolConfig(name: string): ProtocolConfig | null {
  // If it looks like a file path, load it directly
  if (name.endsWith(".json") && existsSync(name)) {
    try {
      return JSON.parse(readFileSync(name, "utf-8")) as ProtocolConfig;
    } catch {
      return null;
    }
  }

  const lower = name.toLowerCase();
  const builtIn = BUILT_IN_CONFIGS[lower];
  if (builtIn && existsSync(builtIn)) {
    try {
      return JSON.parse(readFileSync(builtIn, "utf-8")) as ProtocolConfig;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Auto-detect the protocol for a project by checking which config files'
 * patterns produce the most hits.
 */
export function autoDetectProtocol(projectPath: string): string | null {
  const configNames = Object.keys(BUILT_IN_CONFIGS);
  let bestConfig = "";
  let bestHits = 0;

  for (const name of configNames) {
    const config = loadProtocolConfig(name);
    if (!config) continue;

    // Quick scan: sample up to 20 source files
    const files = findSourceFiles(projectPath, 20);
    let hits = 0;
    for (const f of files) {
      const content = readFileSafe(f);
      if (!content) continue;
      for (const p of [...config.clientPatterns, ...config.serverPatterns]) {
        try {
          const re = new RegExp(p.regex, "g");
          const matches = content.match(re);
          if (matches) hits += matches.length;
        } catch {
          // skip malformed regex
        }
      }
    }

    if (hits > bestHits) {
      bestHits = hits;
      bestConfig = name;
    }
  }

  return bestHits > 0 ? bestConfig : null;
}

// ---------------------------------------------------------------------------
// File scanning helpers
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".svelte",
  ".vue",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  ".vite",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".cache",
  "target", // Rust
  "bin",
  "obj",
  ".claude",
  ".omc",
  "PMM",
]);

function findSourceFiles(dir: string, maxFiles: number = 500): string[] {
  const results: string[] = [];
  const resolved = resolve(dir);

  function walk(current: string) {
    if (results.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const fullPath = join(current, entry);
      const baseName = entry.toLowerCase();

      // Skip hidden files and known build dirs
      if (baseName.startsWith(".") && baseName !== ".env") continue;
      if (SKIP_DIRS.has(baseName)) continue;

      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = extname(fullPath).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(resolved);
  return results;
}

function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Apply a pattern rule against file content and return all matches
 * with their file path, line number, and captured channel name.
 */
function matchPattern(
  content: string,
  rule: PatternRule,
  filePath: string,
  projectPath: string,
  side: ChannelHit["side"],
): ChannelHit[] {
  const hits: ChannelHit[] = [];
  try {
    const re = new RegExp(rule.regex, "g");
    const lines = content.split("\n");
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      const channel = rule.captureGroup > 0 ? (match[rule.captureGroup]?.trim() ?? "") : "";
      if (!channel && rule.captureGroup > 0) continue;

      // Find the line number by counting newlines before match index
      const line = (content.slice(0, match.index).match(/\n/g) || []).length + 1;

      hits.push({
        channel,
        file: relative(projectPath, filePath),
        line,
        patternName: rule.name,
        side,
      });
    }
  } catch {
    // Skip malformed regex patterns silently
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Lifecycle event filters
// ---------------------------------------------------------------------------

/**
 * Socket.IO / WebSocket lifecycle events that are emitted by the library
 * itself, not by application code. These should be excluded from gap
 * detection to avoid noise.
 *
 * All values are lowercase for case-insensitive matching.
 */
const LIFECYCLE_EVENTS = new Set([
  "connect",
  "disconnect",
  "disconnecting",
  "connection",
  "message",
  "data",
  "end",
  "close",
  "open",
  "error",
  "connect_error",
  "connect_timeout",
  "reconnect",
  "reconnect_attempt",
  "reconnecting",
  "reconnect_error",
  "reconnect_failed",
  "ping",
  "pong",
  "online",
  "offline",
  "sigint",
  "sigterm",
  "sighup",
  "unload",
  "beforeunload",
  "welcome",
  "newlistener",
  "removelistener",
  "authenticated",
  "unauthorized",
  "auth_error",
]);

function isLifecycleEvent(channel: string): boolean {
  return LIFECYCLE_EVENTS.has(channel.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

/**
 * Normalize a channel name for comparison purposes:
 * - Remove leading/trailing whitespace
 * - Handle `command` wrapper: if channel looks like a wrapped command,
 *   also check the unwrapped name and vice versa
 */
function normalizeChannel(channel: string): string {
  return channel.trim();
}

/**
 * Detect if a channel name indicates it's wrapped in a `command` envelope
 * (e.g., Socket.IO where client emits `command` with `{ type: 'chat.send' }`
 *  but server listens directly for `chat.send`)
 */
function hasWrapperMismatch(clientChannel: string, serverChannel: string): boolean {
  const c = clientChannel.toLowerCase().trim();
  const s = serverChannel.toLowerCase().trim();
  // Direct match
  if (c === s) return false;
  // Client sends wrapped (e.g., client emits to 'command' with type='chat.send')
  // Server listens for the inner type directly
  if (c === "command" && s !== "command") return true;
  // Client sends to a channel that server receives as a property
  if (s === "command" && c !== "command") return true;
  return false;
}

function detectGaps(
  clientHits: ChannelHit[],
  serverHits: ChannelHit[],
  projectPath: string,
  protocol: string,
): { gaps: ProtocolGap[]; matched: number; unmatched: number } {
  const gaps: ProtocolGap[] = [];
  let matched = 0;

  // Filter lifecycle events — they are system-level, not application protocol
  const appClientHits = clientHits.filter((h) => !isLifecycleEvent(h.channel));
  const appServerHits = serverHits.filter((h) => !isLifecycleEvent(h.channel));

  // Build sets of normalized channel names
  const clientChannels = new Set(appClientHits.map((h) => normalizeChannel(h.channel)));
  const serverChannels = new Set(appServerHits.map((h) => normalizeChannel(h.channel)));

  // Index hits by channel for lookup
  const clientByChannel = new Map<string, ChannelHit[]>();
  for (const h of appClientHits) {
    const key = normalizeChannel(h.channel);
    if (!clientByChannel.has(key)) clientByChannel.set(key, []);
    clientByChannel.get(key)!.push(h);
  }

  const serverByChannel = new Map<string, ChannelHit[]>();
  for (const h of appServerHits) {
    const key = normalizeChannel(h.channel);
    if (!serverByChannel.has(key)) serverByChannel.set(key, []);
    serverByChannel.get(key)!.push(h);
  }

  // 1. Check client channels that have no matching server handler
  for (const [ch, hits] of clientByChannel) {
    if (serverChannels.has(ch)) {
      matched++;
      continue;
    }

    // Check for wrapper mismatch
    let wrapperFound = false;
    for (const sc of serverChannels) {
      if (hasWrapperMismatch(ch, sc)) {
        const serverHits = serverByChannel.get(sc)!;
        gaps.push({
          severity: "critical",
          type: "channel_mismatch",
          clientFile: hits[0].file,
          clientLine: hits[0].line,
          serverFile: serverHits[0].file,
          serverLine: serverHits[0].line,
          clientChannel: ch,
          serverChannel: sc,
          description: `Client emits '${ch}' but server expects '${sc}' — possible wrapping mismatch`,
        });
        wrapperFound = true;
        break;
      }
    }
    if (wrapperFound) continue;

    // Check for partial match
    let partialFound = false;
    for (const sc of serverChannels) {
      if (ch.includes(sc) || sc.includes(ch)) {
        const serverHits = serverByChannel.get(sc)!;
        gaps.push({
          severity: "warning",
          type: "channel_mismatch",
          clientFile: hits[0].file,
          clientLine: hits[0].line,
          serverFile: serverHits[0].file,
          serverLine: serverHits[0].line,
          clientChannel: ch,
          serverChannel: sc,
          description: `Client emits '${ch}' partially matches server '${sc}' — possible naming convention mismatch`,
        });
        partialFound = true;
        break;
      }
    }
    if (partialFound) continue;

    // Completely unmatched client channel
    gaps.push({
      severity: "critical",
      type: "unmatched_send",
      clientFile: hits[0].file,
      clientLine: hits[0].line,
      clientChannel: ch,
      description: `Client emits '${ch}' but server has NO handler for this channel`,
    });
  }

  // 2. Check server handlers that have no client sender
  for (const [ch, hits] of serverByChannel) {
    if (clientChannels.has(ch)) continue;

    // Skip channels already accounted for in wrapper detection above
    let alreadyGapped = false;
    for (const g of gaps) {
      if (g.serverChannel === ch || g.clientChannel === ch) {
        alreadyGapped = true;
        break;
      }
    }
    if (alreadyGapped) continue;

    // Check for wrapper mismatch
    let wrapperFound = false;
    for (const cc of clientChannels) {
      if (hasWrapperMismatch(cc, ch)) {
        wrapperFound = true;
        break;
      }
    }
    if (wrapperFound) continue;

    gaps.push({
      severity: "warning",
      type: "unmatched_receive",
      serverFile: hits[0].file,
      serverLine: hits[0].line,
      clientChannel: ch,
      description: `Server listens for '${ch}' but client never emits this channel`,
    });
  }

  const unmatched = gaps.length;

  return { gaps, matched, unmatched };
}

// ---------------------------------------------------------------------------
// Response channel analysis
// ---------------------------------------------------------------------------

function analyzeResponseGaps(
  responseHits: ChannelHit[],
  clientHits: ChannelHit[],
  serverHits: ChannelHit[],
  projectPath: string,
): ProtocolGap[] {
  const gaps: ProtocolGap[] = [];

  if (responseHits.length === 0) return gaps;

  const responseChannels = new Set(responseHits.map((h) => normalizeChannel(h.channel)));
  const allChannels = new Set([
    ...clientHits.map((h) => normalizeChannel(h.channel)),
    ...serverHits.map((h) => normalizeChannel(h.channel)),
  ]);

  // Check if response channels reference channels that don't exist
  for (const hit of responseHits) {
    if (!hit.channel) continue;
    // Response channels often use convention like 'response:chat.send' or 'ack:chat.send'
    // Extract the referenced channel
    const colonIdx = hit.channel.indexOf(":");
    const refChannel = colonIdx >= 0 ? hit.channel.slice(colonIdx + 1) : hit.channel;

    if (!allChannels.has(normalizeChannel(refChannel))) {
      gaps.push({
        severity: "info",
        type: "response_mismatch",
        clientFile: hit.file,
        clientLine: hit.line,
        clientChannel: hit.channel,
        description: `Response channel '${hit.channel}' references '${refChannel}' which has no primary handler`,
      });
    }
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Max files to scan (default: 500) */
  maxFiles?: number;
  /** Custom file extensions to include (added to defaults) */
  extraExtensions?: string[];
}

/**
 * Scan a project's source files for protocol alignment gaps.
 *
 * @param projectPath - Absolute or relative path to the project root
 * @param config - Protocol configuration with client/server/response patterns
 * @param options - Optional scan settings
 * @returns Structured gap report
 */
export function scanProtocolAlignment(
  projectPath: string,
  config: ProtocolConfig,
  options: ScanOptions = {},
): ProtocolScanResult {
  const resolvedPath = resolve(projectPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Project path not found: ${resolvedPath}`);
  }

  const files = findSourceFiles(resolvedPath, options.maxFiles ?? 500);
  const allHits: ChannelHit[] = [];

  for (const file of files) {
    const content = readFileSafe(file);
    if (!content) continue;

    // Apply client patterns
    for (const rule of config.clientPatterns) {
      const hits = matchPattern(content, rule, file, resolvedPath, "client");
      allHits.push(...hits);
    }

    // Apply server patterns
    for (const rule of config.serverPatterns) {
      const hits = matchPattern(content, rule, file, resolvedPath, "server");
      allHits.push(...hits);
    }

    // Apply response patterns
    if (config.responsePatterns) {
      for (const rule of config.responsePatterns) {
        const hits = matchPattern(content, rule, file, resolvedPath, "response");
        allHits.push(...hits);
      }
    }
  }

  const clientHits = allHits.filter((h) => h.side === "client");
  const serverHits = allHits.filter((h) => h.side === "server");
  const responseHits = allHits.filter((h) => h.side === "response");

  // Deduplicate channel lists
  const clientChannels = [...new Set(clientHits.map((h) => normalizeChannel(h.channel)))].sort();
  const serverChannels = [...new Set(serverHits.map((h) => normalizeChannel(h.channel)))].sort();

  // Detect gaps
  const {
    gaps: primaryGaps,
    matched,
    unmatched,
  } = detectGaps(clientHits, serverHits, resolvedPath, config.name);

  // Response analysis
  const responseGaps = analyzeResponseGaps(responseHits, clientHits, serverHits, resolvedPath);

  return {
    projectPath: resolvedPath,
    protocol: config.name,
    hits: allHits,
    clientChannels,
    serverChannels,
    gaps: [...primaryGaps, ...responseGaps],
    matched,
    unmatched,
    filesScanned: files.length,
  };
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

/**
 * Format a scan result as a human-readable box report (similar to the spec).
 */
export function formatScanReport(result: ProtocolScanResult): string {
  const lines: string[] = [];
  const protocol = result.protocol.toUpperCase();
  const projectName = result.projectPath.split(/[/\\]/).pop() || result.projectPath;
  const width = 60;

  const sep = `\u2550`.repeat(width);

  // Header
  lines.push(`\u2554${sep}\u2557`);
  lines.push(
    `\u2551  Protocol Alignment: ${projectName} (${protocol})`.padEnd(width + 3) + "\u2551",
  );
  lines.push(`\u2560${sep}\u2563`);

  // Summary
  lines.push(
    `\u2551  Client channels: ${result.clientChannels.length}`.padEnd(width + 3) + "\u2551",
  );
  lines.push(
    `\u2551  Server channels: ${result.serverChannels.length}`.padEnd(width + 3) + "\u2551",
  );
  lines.push(`\u2551  Matched:         ${result.matched}`.padEnd(width + 3) + "\u2551");
  lines.push(`\u2551  Unmatched:       ${result.unmatched}`.padEnd(width + 3) + "\u2551");
  lines.push(`\u2551  Files scanned:   ${result.filesScanned}`.padEnd(width + 3) + "\u2551");
  lines.push(`\u2560${sep}\u2563`);

  // Gaps by severity
  const criticalGaps = result.gaps.filter((g) => g.severity === "critical");
  const warningGaps = result.gaps.filter((g) => g.severity === "warning");
  const infoGaps = result.gaps.filter((g) => g.severity === "info");

  if (criticalGaps.length > 0) {
    lines.push(`\u2551  CRITICAL GAPS`.padEnd(width + 3) + "\u2551");
    for (const g of criticalGaps) {
      lines.push(`\u2551  \u2717 ${g.description}`.padEnd(width + 3) + "\u2551");
      const loc = `${g.clientFile}:${g.clientLine}`;
      if (g.serverFile) {
        lines.push(
          `\u2551    ${loc} \u2192 ${g.serverFile}:${g.serverLine}`.padEnd(width + 3) + "\u2551",
        );
      } else {
        lines.push(`\u2551    ${loc}`.padEnd(width + 3) + "\u2551");
      }
    }
  }

  if (warningGaps.length > 0) {
    lines.push(`\u2551  WARNINGS`.padEnd(width + 3) + "\u2551");
    for (const g of warningGaps) {
      lines.push(`\u2551  \u26A0 ${g.description}`.padEnd(width + 3) + "\u2551");
      const loc = g.clientFile
        ? `${g.clientFile}:${g.clientLine}`
        : `${g.serverFile}:${g.serverLine}`;
      lines.push(`\u2551    ${loc}`.padEnd(width + 3) + "\u2551");
    }
  }

  if (infoGaps.length > 0) {
    lines.push(`\u2551  INFO`.padEnd(width + 3) + "\u2551");
    for (const g of infoGaps) {
      lines.push(`\u2551  \u2139 ${g.description}`.padEnd(width + 3) + "\u2551");
      lines.push(`\u2551    ${g.clientFile}:${g.clientLine}`.padEnd(width + 3) + "\u2551");
    }
  }

  if (result.gaps.length === 0) {
    lines.push(`\u2551  No gaps found - protocol alignment is clean!`.padEnd(width + 3) + "\u2551");
  }

  lines.push(`\u255a${sep}\u255d`);

  return lines.join("\n");
}
