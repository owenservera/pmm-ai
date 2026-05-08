import { expect, test, beforeEach } from "bun:test";
import { bus, emit, on, once, emitSync, type PMMEvent } from "./events";

// Reset bus state before each test
beforeEach(() => {
  bus.clear();
});

// ── Core functionality ───────────────────────────────────────────────────────

test("emits and receives a typed event", async () => {
  const received: PMMEvent[] = [];
  const off = on("worker:dispatched", (e) => received.push(e));

  await emit({
    type: "worker:dispatched",
    worker_id: 1,
    project_id: 2,
    agent_type: "executor",
    model: "sonnet",
  });

  expect(received).toHaveLength(1);
  expect(received[0]!.type).toBe("worker:dispatched");
  if (received[0]!.type === "worker:dispatched") {
    expect(received[0]!.worker_id).toBe(1);
    expect(received[0]!.agent_type).toBe("executor");
  }
  off();
});

test("wildcard listener receives all event types", async () => {
  const received: PMMEvent[] = [];
  const off = on("*", (e) => received.push(e));

  await emit({ type: "session:started", session_id: 1, project_id: 1, harness: "antigravity" });
  await emit({ type: "health:alert",    alert_id: 1,   project_id: 1, severity: "P1", message: "test" });
  await emit({ type: "drift:detected",  project_id: 1, gaps: [] });

  expect(received).toHaveLength(3);
  expect(received.map((e) => e.type)).toEqual([
    "session:started",
    "health:alert",
    "drift:detected",
  ]);
  off();
});

test("once fires exactly once then unsubscribes", async () => {
  let count = 0;
  once("session:ended", () => { count++; });

  await emit({ type: "session:ended", session_id: 1, project_id: 1, summary: "done" });
  await emit({ type: "session:ended", session_id: 2, project_id: 1, summary: "done again" });

  expect(count).toBe(1);
});

test("off() correctly removes a specific listener", async () => {
  const received: number[] = [];
  const off1 = on("worker:completed", (e) => {
    if (e.type === "worker:completed") received.push(e.worker_id);
  });
  const off2 = on("worker:completed", (e) => {
    if (e.type === "worker:completed") received.push(e.worker_id * 10);
  });

  await emit({ type: "worker:completed", worker_id: 5, project_id: 1 });
  off1();
  await emit({ type: "worker:completed", worker_id: 5, project_id: 1 });

  expect(received).toEqual([5, 50, 50]); // first emit gets both, second only off2
  off2();
});

test("multiple listeners on same event fire concurrently", async () => {
  const order: string[] = [];

  on("milestone:updated", async () => {
    await new Promise((r) => setTimeout(r, 10));
    order.push("slow");
  });
  on("milestone:updated", () => {
    order.push("fast");
  });

  await emit({ type: "milestone:updated", milestone_id: 1, project_id: 1, status: "completed" });

  // Both must have fired (order may vary since they run concurrently)
  expect(order).toContain("slow");
  expect(order).toContain("fast");
  expect(order).toHaveLength(2);
});

test("listener errors are caught and do not prevent other listeners", async () => {
  const errors: unknown[] = [];
  bus.onError((err) => errors.push(err));

  on("feature:updated", () => { throw new Error("listener boom"); });
  on("feature:updated", (e) => {
    // This should still run even though the first listener threw
    expect(e.type).toBe("feature:updated");
  });

  await emit({ type: "feature:updated", feature_id: 1, project_id: 1, status: "done" });

  expect(errors).toHaveLength(1);
  expect((errors[0] as Error).message).toBe("listener boom");
});

test("async listeners are properly awaited", async () => {
  let resolved = false;

  on("worker:started", async () => {
    await new Promise((r) => setTimeout(r, 20));
    resolved = true;
  });

  await emit({ type: "worker:started", worker_id: 1, project_id: 1 });

  expect(resolved).toBe(true);
});

test("listenerCount returns correct counts", () => {
  const off1 = on("session:started", () => {});
  const off2 = on("session:started", () => {});
  const off3 = on("*", () => {});

  expect(bus.listenerCount("session:started")).toBe(2);
  expect(bus.listenerCount("worker:dispatched")).toBe(0);
  expect(bus.listenerCount()).toBe(3); // total including wildcard

  off1();
  expect(bus.listenerCount("session:started")).toBe(1);
  expect(bus.listenerCount()).toBe(2);

  off2(); off3();
});

test("totalEmitted counter increments correctly", async () => {
  const before = bus.totalEmitted;

  await emit({ type: "drift:detected", project_id: 1, gaps: [] });
  await emit({ type: "drift:resolved", project_id: 1 });

  expect(bus.totalEmitted).toBe(before + 2);
});

test("emitSync fires without awaiting", async () => {
  const received: PMMEvent[] = [];
  on("harness:connected", (e) => received.push(e));

  emitSync({
    type: "harness:connected",
    harness: "antigravity",
    session_id: "antigravity-abc123",
    project_id: 1,
  });

  // emitSync is fire-and-forget — need to yield for microtasks
  await new Promise((r) => setTimeout(r, 10));
  expect(received).toHaveLength(1);
});

test("clear() removes all listeners", async () => {
  const received: PMMEvent[] = [];
  on("project:updated", (e) => received.push(e));
  on("*", (e) => received.push(e));

  bus.clear();

  await emit({ type: "project:updated", project_id: 1, fields: { health: "blocked" } });

  expect(received).toHaveLength(0);
});

test("harness lifecycle events work end-to-end", async () => {
  const events: PMMEvent[] = [];

  on("harness:connected",    (e) => events.push(e));
  on("session:started",      (e) => events.push(e));
  on("worker:dispatched",    (e) => events.push(e));
  on("worker:completed",     (e) => events.push(e));
  on("session:ended",        (e) => events.push(e));
  on("harness:disconnected", (e) => events.push(e));

  await emit({ type: "harness:connected",    harness: "antigravity", session_id: "ag-001", project_id: 5 });
  await emit({ type: "session:started",      session_id: 18, project_id: 5, harness: "antigravity", model: "claude-sonnet-4-5" });
  await emit({ type: "worker:dispatched",    worker_id: 19, project_id: 5, agent_type: "executor", model: "sonnet" });
  await emit({ type: "worker:completed",     worker_id: 19, project_id: 5, result_summary: "Track D done" });
  await emit({ type: "session:ended",        session_id: 18, project_id: 5, summary: "Event bus implemented" });
  await emit({ type: "harness:disconnected", harness: "antigravity", session_id: "ag-001" });

  expect(events).toHaveLength(6);
  expect(events.map((e) => e.type)).toEqual([
    "harness:connected",
    "session:started",
    "worker:dispatched",
    "worker:completed",
    "session:ended",
    "harness:disconnected",
  ]);
});
