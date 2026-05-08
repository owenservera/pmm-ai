/**
 * PMM Project Discovery
 * ======================
 * Auto-discover project metadata from a directory path.
 * Returns structured data for registration.
 *
 * Rust-translatable: pure filesystem scanning function — would become
 * a standalone discover crate with no DB dependency.
 */

/** Auto-discover project metadata from a directory path. */
export function discoverProject(dirPath: string): {
  name: string;
  description: string | null;
  tech_stack: string[];
  phase: string;
  priority: string;
  repo_path: string;
  git_remote: string | null;
  git_branch: string | null;
  git_commits: number;
  tools: { name: string; category: string; priority: string }[];
  warnings: string[];
} {
  const fs = require("node:fs");
  const path = require("node:path");
  const { execSync } = require("node:child_process");
  const abs = path.resolve(dirPath);
  const warnings: string[] = [];
  let name = path.basename(abs);
  let description: string | null = null;
  const tech_stack: string[] = [];
  let phase = "define";
  let priority = "medium";
  const tools: { name: string; category: string; priority: string }[] = [];

  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Directory not found: ${abs}`);
  }

  // 1. Parse package.json if it exists
  const pkgPath = path.join(abs, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.name) name = pkg.name;
      if (pkg.description) description = pkg.description;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depMap: Record<string, string> = {
        "react": "React", "next": "Next.js", "vue": "Vue", "svelte": "Svelte",
        "typescript": "TypeScript", "bun": "Bun", "node": "Node.js",
        "express": "Express", "fastify": "Fastify", "hono": "Hono",
        "python": "Python", "go": "Go", "rust": "Rust",
        "prisma": "Prisma", "drizzle": "Drizzle", "knex": "Knex",
        "vitest": "Vitest", "jest": "Jest", "playwright": "Playwright",
        "tailwindcss": "Tailwind", "sass": "Sass",
        "vite": "Vite", "webpack": "Webpack", "esbuild": "esbuild",
        "docker": "Docker", "kubernetes": "Kubernetes",
      };
      for (const [dep, label] of Object.entries(depMap)) {
        if (deps[dep]) tech_stack.push(label);
      }
      if (pkg.version && pkg.version.startsWith("0.")) phase = "define";
      else if (pkg.version && pkg.version.startsWith("1.")) phase = "build";
      if (pkg.scripts?.test) phase = phase === "define" ? "design" : phase;
      if (pkg.scripts?.build && pkg.scripts?.test) phase = "build";
    } catch (e: any) {
      warnings.push(`package.json parse error: ${e.message}`);
    }
  }

  // 2. Check for TypeScript config
  if (fs.existsSync(path.join(abs, "tsconfig.json"))) {
    if (!tech_stack.includes("TypeScript")) tech_stack.push("TypeScript");
    tools.push({ name: "TypeScript", category: "language", priority: "critical" });
  }

  // 3. Read README.md
  const readmePath = path.join(abs, "README.md");
  if (fs.existsSync(readmePath)) {
    try {
      const readme = fs.readFileSync(readmePath, "utf-8");
      const titleMatch = readme.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        const title = titleMatch[1]!;
        if (!name || name === path.basename(abs)) name = title;
        if (!description) {
          const nextLine = readme.split("\n").slice(1).find((l: string) => l.trim() && !l.startsWith("#") && !l.startsWith("[") && !l.startsWith("!"));
          if (nextLine) description = nextLine.trim().replace(/^\*\*/, "").replace(/\*\*$/, "").substring(0, 200);
        }
      }
      if (readme.toLowerCase().includes("research") || readme.toLowerCase().includes("design doc")) {
        if (phase === "build") phase = "design";
      }
    } catch (_) {}
  }

  // 4. Config file → tool mapping
  const configToolMap: Record<string, { name: string; category: string; priority: string }> = {
    "biome.json": { name: "Biome", category: "formatting", priority: "high" },
    ".eslintrc.js": { name: "ESLint", category: "formatting", priority: "high" },
    ".eslintrc.cjs": { name: "ESLint", category: "formatting", priority: "high" },
    "eslint.config.js": { name: "ESLint", category: "formatting", priority: "high" },
    "eslint.config.mjs": { name: "ESLint", category: "formatting", priority: "high" },
    "vitest.config.ts": { name: "Vitest", category: "testing", priority: "high" },
    "vitest.config.js": { name: "Vitest", category: "testing", priority: "high" },
    "jest.config.js": { name: "Jest", category: "testing", priority: "high" },
    "jest.config.ts": { name: "Jest", category: "testing", priority: "high" },
    "playwright.config.ts": { name: "Playwright", category: "testing", priority: "high" },
    "lefthook.yml": { name: "lefthook", category: "git-hooks", priority: "medium" },
    "Dockerfile": { name: "Docker", category: "container", priority: "medium" },
    "vite.config.ts": { name: "Vite", category: "build", priority: "high" },
    "vite.config.js": { name: "Vite", category: "build", priority: "high" },
    "turbo.json": { name: "Turborepo", category: "monorepo", priority: "medium" },
    ".goreleaser.yaml": { name: "GoReleaser", category: "release", priority: "medium" },
    "pyproject.toml": { name: "Python", category: "language", priority: "high" },
    "Cargo.toml": { name: "Rust", category: "language", priority: "high" },
    "go.mod": { name: "Go", category: "language", priority: "high" },
    "Makefile": { name: "Make", category: "build", priority: "medium" },
    "docker-compose.yml": { name: "Docker Compose", category: "container", priority: "medium" },
  };
  for (const [file, tool] of Object.entries(configToolMap)) {
    if (fs.existsSync(path.join(abs, file))) {
      tools.push(tool);
      if (tool.category === "testing" || tool.category === "build") {
        if (phase === "define" || phase === "design") phase = "build";
      }
    }
  }

  // 5. Check .github/workflows for CI
  const workflowsDir = path.join(abs, ".github", "workflows");
  if (fs.existsSync(workflowsDir)) {
    try {
      const wfs = fs.readdirSync(workflowsDir);
      if (wfs.some((f: string) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
        tools.push({ name: "GitHub Actions", category: "ci", priority: "high" });
        if (phase === "define") phase = "design";
      }
    } catch (_) {}
  }

  // 6. Check .claude/ directory for MCP, skills, agents
  const claudeDir = path.join(abs, ".claude");
  if (fs.existsSync(claudeDir)) {
    try {
      if (fs.existsSync(path.join(claudeDir, "mcp.json"))) {
        tools.push({ name: "MCP Servers", category: "mcp", priority: "high" });
      }
      const skillsDir = path.join(claudeDir, "skills");
      if (fs.existsSync(skillsDir)) {
        const skillFiles = fs.readdirSync(skillsDir).filter((f: string) => f.endsWith(".md") || fs.statSync(path.join(skillsDir, f)).isDirectory());
        if (skillFiles.length > 0) {
          tools.push({ name: `Skills (${skillFiles.length})`, category: "skill", priority: "medium" });
        }
      }
      const agentsDir = path.join(claudeDir, "agents");
      if (fs.existsSync(agentsDir)) {
        const agentFiles = fs.readdirSync(agentsDir).filter((f: string) => f.endsWith(".md"));
        if (agentFiles.length > 0) {
          tools.push({ name: `Agents (${agentFiles.length})`, category: "agent", priority: "medium" });
        }
      }
    } catch (_) {}
  }

  // 7. Git metadata
  let git_remote: string | null = null;
  let git_branch: string | null = null;
  let git_commits = 0;
  try {
    git_remote = execSync("git remote get-url origin", { cwd: abs, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (_) {}
  try {
    git_branch = execSync("git branch --show-current", { cwd: abs, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (_) {}
  try {
    git_commits = parseInt(execSync("git rev-list --count HEAD", { cwd: abs, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim());
  } catch (_) {}

  // 8. Phase refinement based on code vs docs ratio
  const codeExts = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".svelte", ".vue"];
  const docsDirs = ["designs", "docs", "specs", "research", "design"];
  let codeFileCount = 0, hasDocsDirs = false;
  try {
    const entries = fs.readdirSync(abs, { recursive: true });
    for (const entry of entries.slice(0, 500)) {
      if (codeExts.some((ext) => entry.endsWith(ext))) codeFileCount++;
    }
  } catch (_) {}
  for (const d of docsDirs) {
    if (fs.existsSync(path.join(abs, d))) { hasDocsDirs = true; break; }
  }
  const hasBuildTooling = fs.existsSync(path.join(abs, "package.json")) ||
    fs.existsSync(path.join(abs, "tsconfig.json")) ||
    fs.existsSync(path.join(abs, "pyproject.toml")) ||
    fs.existsSync(path.join(abs, "Cargo.toml")) ||
    fs.existsSync(path.join(abs, "go.mod")) ||
    fs.existsSync(path.join(abs, "Makefile"));
  if (hasDocsDirs && !hasBuildTooling && phase !== "build") {
    phase = "design";
  }
  if (codeFileCount === 0 && phase === "build") phase = "design";

  // 9. Priority detection
  if (git_commits > 100 || (fs.existsSync(pkgPath) && phase === "build")) priority = "high";
  if (name.toLowerCase().includes("pmm") || name.toLowerCase().includes("core")) priority = "critical";

  // 10. Deduplicate tools by name
  const seen = new Set<string>();
  const dedupedTools = tools.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });

  return {
    name,
    description,
    tech_stack: [...new Set(tech_stack)],
    phase,
    priority,
    repo_path: abs.replace(/\\/g, "/"),
    git_remote,
    git_branch,
    git_commits,
    tools: dedupedTools,
    warnings,
  };
}

/** Interactive prompt helper — reads one line from stdin. */
export async function __prompt(question: string): Promise<string> {
  const readline = require("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
}
