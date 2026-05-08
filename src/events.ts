/**
 * CNS Event Bus
 * =============
 * Typed pub/sub singleton connecting all PMM components.
 * Supports per-type listeners, wildcard listeners, and one-shot listeners.
 *
 * Usage:
 *   import { bus, emit, on } from "./events";
 *   const off = on("worker:dispatched", (e) => console.log(e.worker_id));
 *   await emit({ type: "worker:dispatched", worker_id: 1, project_id: 2, agent_type: "executor" });
 *   off(); // unsubscribe
 */

// ── Event Catalogue ──────────────────────────────────────────────────────────

export type PMMEvent =
  // Project lifecycle
  | { type: "project:updated";     project_id: number; fields: Record<string, unknown> }
  | { type: "project:health";      project_id: number; health: string; previous: string }

  // Planning
  | { type: "milestone:updated";   milestone_id: number; project_id: number; status: string }
  | { type: "feature:updated";     feature_id: number;   project_id: number; status: string }
  | { type: "decision:added";      decision_id: number;  project_id: number; question: string }
  | { type: "roadblock:added";     roadblock_id: number; project_id: number; severity: string }

  // Agent workers
  | { type: "worker:dispatched";   worker_id: number; project_id: number; agent_type: string; model: string }
  | { type: "worker:started";      worker_id: number; project_id: number }
  | { type: "worker:completed";    worker_id: number; project_id: number; result_summary?: string }
  | { type: "worker:failed";       worker_id: number; project_id: number; error?: string }

  // Sessions
  | { type: "session:started";     session_id: number; project_id: number; harness: string; model?: string }
  | { type: "session:ended";       session_id: number; project_id: number; summary: string }

  // Alerts & health
  | { type: "health:alert";        alert_id: number;  project_id: number; severity: string; message: string }
  | { type: "health:resolved";     alert_id: number;  project_id: number }

  // Swarm
  | { type: "swarm:task_claimed";    task_id: number; worker_id: number; project_id: number }
  | { type: "swarm:task_completed";  task_id: number; worker_id: number; project_id: number }
  | { type: "swarm:task_failed";     task_id: number; worker_id: number; project_id: number; reason?: string }

  // Drift / sync
  | { type: "drift:detected";      project_id: number; gaps: unknown[] }
  | { type: "drift:resolved";      project_id: number }

  // Cross-harness
  | { type: "harness:connected";    harness: string; session_id: string; project_id?: number; model?: string }
  | { type: "harness:disconnected"; harness: string; session_id: string; summary?: string };

// ── Listener types ───────────────────────────────────────────────────────────

type Listener<E extends PMMEvent = PMMEvent> = (event: E) => void | Promise<void>;

type EventType = PMMEvent["type"] | "*";

// ── EventBus class ───────────────────────────────────────────────────────────

class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private wildcardListeners = new Set<Listener>();
  private emitCount = 0;
  private errorHandlers = new Set<(error: unknown, event: PMMEvent) => void>();

  /**
   * Subscribe to a specific event type or all events ("*").
   * Returns an unsubscribe function.
   */
  on(eventType: EventType, listener: Listener): () => void {
    if (eventType === "*") {
      this.wildcardListeners.add(listener);
      return () => this.wildcardListeners.delete(listener);
    }

    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
    return () => this.listeners.get(eventType)?.delete(listener);
  }

  /**
   * Subscribe to an event exactly once — auto-unsubscribes after first fire.
   */
  once(eventType: PMMEvent["type"], listener: Listener): () => void {
    let off: () => void;
    const wrapper: Listener = async (event) => {
      off();
      await listener(event);
    };
    off = this.on(eventType, wrapper);
    return off;
  }

  /**
   * Emit an event. All matching listeners run concurrently.
   * Errors in listeners are caught and forwarded to error handlers (or logged).
   */
  async emit(event: PMMEvent): Promise<void> {
    this.emitCount++;
    const promises: Promise<void>[] = [];

    const typed = this.listeners.get(event.type);
    if (typed) {
      for (const fn of typed) {
        promises.push(this.safeCall(fn, event));
      }
    }

    for (const fn of this.wildcardListeners) {
      promises.push(this.safeCall(fn, event));
    }

    await Promise.allSettled(promises);
  }

  /**
   * Synchronous emit — fires listeners without awaiting.
   * Use for fire-and-forget events where you don't need completion guarantees.
   */
  emitSync(event: PMMEvent): void {
    this.emit(event).catch((err) => this.handleError(err, event));
  }

  /**
   * Register an error handler for listener failures.
   */
  onError(handler: (error: unknown, event: PMMEvent) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /**
   * Number of active listeners for a given event type (or total if omitted).
   */
  listenerCount(eventType?: PMMEvent["type"]): number {
    if (!eventType) {
      let total = this.wildcardListeners.size;
      for (const set of this.listeners.values()) total += set.size;
      return total;
    }
    return this.listeners.get(eventType)?.size ?? 0;
  }

  /**
   * Total events emitted since process start.
   */
  get totalEmitted(): number {
    return this.emitCount;
  }

  /**
   * Remove all listeners (useful in tests).
   */
  clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }

  private async safeCall(fn: Listener, event: PMMEvent): Promise<void> {
    try {
      await fn(event);
    } catch (err) {
      this.handleError(err, event);
    }
  }

  private handleError(err: unknown, event: PMMEvent): void {
    if (this.errorHandlers.size > 0) {
      for (const h of this.errorHandlers) h(err, event);
    } else {
      process.stderr.write(
        `[pmm-events] Unhandled listener error on "${event.type}": ${err}\n`,
      );
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const bus = new EventBus();

// ── Convenience re-exports ───────────────────────────────────────────────────

/** Emit an event on the global bus. */
export const emit = (event: PMMEvent): Promise<void> => bus.emit(event);

/** Subscribe to an event on the global bus. Returns unsubscribe fn. */
export const on = (type: EventType, fn: Listener): (() => void) => bus.on(type, fn);

/** Subscribe once on the global bus. */
export const once = (type: PMMEvent["type"], fn: Listener): (() => void) => bus.once(type, fn);

/** Fire-and-forget emit (no await). */
export const emitSync = (event: PMMEvent): void => bus.emitSync(event);
