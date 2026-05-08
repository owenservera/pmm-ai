/**
 * ContextSnapshot Provider Tests
 * ===============================
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { buildContextSnapshot, clearContextCache } from "../context";

describe("ContextSnapshot Provider", () => {
  beforeEach(() => {
    clearContextCache();
  });

  // -- Test 1: Shape ---------------------------------------------------------
  test("returns ContextSnapshot with expected shape", () => {
    const snapshot = buildContextSnapshot("TERMINAL");

    expect(snapshot).toHaveProperty("active_project");
    expect(snapshot.active_project).toHaveProperty("name");
    expect(snapshot.active_project).toHaveProperty("phase");
    expect(snapshot.active_project).toHaveProperty("health");
    expect(snapshot.active_project).toHaveProperty("priority");
    expect(snapshot.active_project).toHaveProperty("last_session");

    expect(snapshot).toHaveProperty("recent_actions");
    expect(Array.isArray(snapshot.recent_actions)).toBe(true);

    expect(snapshot).toHaveProperty("portfolio_summary");
    expect(snapshot.portfolio_summary).toHaveProperty("total_projects");
    expect(snapshot.portfolio_summary).toHaveProperty("healthy_count");
    expect(snapshot.portfolio_summary).toHaveProperty("attention_count");
    expect(snapshot.portfolio_summary).toHaveProperty("blocked_count");
    expect(snapshot.portfolio_summary).toHaveProperty("stale_count");

    expect(snapshot).toHaveProperty("generated_at");
    expect(typeof snapshot.generated_at).toBe("string");
  });

  // -- Test 2: TERMINAL resolution -------------------------------------------
  test("resolves TERMINAL project correctly", () => {
    const snapshot = buildContextSnapshot("TERMINAL");

    expect(snapshot.active_project.name).toBe("TERMINAL");
    // Valid phases from the PMM schema
    const validPhases = [
      "discover",
      "define",
      "design",
      "build",
      "test",
      "deploy",
      "maintain",
      "unknown",
    ];
    expect(validPhases).toContain(snapshot.active_project.phase);
  });

  // -- Test 3: Nonexistent project (no throw) --------------------------------
  test("returns unknown defaults for nonexistent project (no throw)", () => {
    expect(() => buildContextSnapshot("NONEXISTENT_PROJECT_12345")).not.toThrow();

    const snapshot = buildContextSnapshot("NONEXISTENT_PROJECT_12345");
    expect(snapshot.active_project.name).toBe("unknown");
    expect(snapshot.active_project.phase).toBe("unknown");
    expect(snapshot.active_project.health).toBe("unknown");
    expect(snapshot.active_project.priority).toBe("unknown");
    expect(snapshot.active_project.last_session).toBeNull();
  });

  // -- Test 4: Has projects --------------------------------------------------
  test("portfolio_summary.total_projects is > 0", () => {
    const snapshot = buildContextSnapshot("TERMINAL");
    expect(snapshot.portfolio_summary.total_projects).toBeGreaterThan(0);
  });

  // -- Test 5: Cache hit -----------------------------------------------------
  test("cache hit: two calls within TTL return same generated_at", () => {
    const first = buildContextSnapshot("TERMINAL");
    const second = buildContextSnapshot("TERMINAL");
    expect(second.generated_at).toBe(first.generated_at);
  });

  // -- Test 6: Cache miss after clear ----------------------------------------
  test("cache miss after clearContextCache: different generated_at", () => {
    const first = buildContextSnapshot("TERMINAL");
    clearContextCache();
    const second = buildContextSnapshot("TERMINAL");
    expect(second.generated_at).not.toBe(first.generated_at);
  });
});
