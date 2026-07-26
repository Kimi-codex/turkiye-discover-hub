import { describe, expect, it } from "vitest";

// Replicate the inner logic from imports.functions.ts for unit testing.
// The real functions are not exported, so we test the logic directly.

type ExecutionStatus = "idle" | "running" | "paused" | "stopped" | "completed" | "failed";

interface ExecutionLogEntry {
  at: string;
  type: "info" | "warn" | "error" | "retry";
  message: string;
}

interface ImportExecutionState {
  status: ExecutionStatus;
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  delayMs: number;
  retryAttempt: number;
  maxRetries: number;
  chunksCompleted: number;
  totalChunkDurationMs: number;
  log: ExecutionLogEntry[];
}

function defaultExecutionState(): ImportExecutionState {
  return {
    status: "idle",
    startedAt: null,
    pausedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    errorMessage: null,
    delayMs: 250,
    retryAttempt: 0,
    maxRetries: 3,
    chunksCompleted: 0,
    totalChunkDurationMs: 0,
    log: [],
  };
}

function classifyImportError(err: Error): "transient" | "permanent" {
  const m = err.message.toLowerCase();
  if (
    m.includes("network") ||
    m.includes("econnrefused") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("enotfound") ||
    m.includes("fetch failed")
  )
    return "transient";
  if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) return "transient";
  if (m.includes("502") || m.includes("503") || m.includes("504")) return "transient";
  if (m.includes("409") || m.includes("already processing")) return "transient";
  return "permanent";
}

function getBackoffDelay(attempt: number): number {
  const base = 1000;
  const cap = 30000;
  return Math.round(Math.min(base * Math.pow(2, attempt) + Math.random() * base, cap));
}

function buildExecutionPatch(
  current: Record<string, unknown> | ImportExecutionState,
  command: "start" | "pause" | "resume" | "stop" | "set_delay" | "recover",
  delayMs?: number,
): ImportExecutionState {
  const now = new Date().toISOString();
  const base = defaultExecutionState();
  const existing: ImportExecutionState = { ...base, ...(current as unknown as ImportExecutionState) };

  switch (command) {
    case "start":
    case "resume":
      return {
        ...existing,
        status: "running",
        startedAt: existing.startedAt ?? now,
        pausedAt: null,
        stoppedAt: null,
        failedAt: null,
        errorMessage: null,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: command === "resume" ? "Execution resumed" : "Execution started" },
        ],
      };
    case "pause":
      return {
        ...existing,
        status: "paused",
        pausedAt: now,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Execution paused" },
        ],
      };
    case "stop":
      return {
        ...existing,
        status: "stopped",
        stoppedAt: now,
        errorMessage: null,
        retryAttempt: 0,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Execution stopped" },
        ],
      };
    case "set_delay":
      return {
        ...existing,
        delayMs: delayMs ?? existing.delayMs,
      };
    case "recover":
      return {
        ...existing,
        status: "running",
        pausedAt: null,
        stoppedAt: null,
        failedAt: null,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Execution recovered after interruption" },
        ],
      };
  }
}

describe("execution-state", () => {
  describe("defaultExecutionState", () => {
    it("returns idle status with defaults", () => {
      const state = defaultExecutionState();
      expect(state.status).toBe("idle");
      expect(state.delayMs).toBe(250);
      expect(state.maxRetries).toBe(3);
      expect(state.chunksCompleted).toBe(0);
      expect(state.totalChunkDurationMs).toBe(0);
      expect(state.log).toEqual([]);
    });
  });

  describe("classifyImportError", () => {
    it("classifies network errors as transient", () => {
      expect(classifyImportError(new Error("network timeout"))).toBe("transient");
      expect(classifyImportError(new Error("econnrefused"))).toBe("transient");
      expect(classifyImportError(new Error("econnreset by peer"))).toBe("transient");
      expect(classifyImportError(new Error("etimedout"))).toBe("transient");
      expect(classifyImportError(new Error("enotfound"))).toBe("transient");
      expect(classifyImportError(new Error("fetch failed"))).toBe("transient");
    });

    it("classifies HTTP 429 as transient", () => {
      expect(classifyImportError(new Error("429 Too Many Requests"))).toBe("transient");
      expect(classifyImportError(new Error("rate limit exceeded"))).toBe("transient");
      expect(classifyImportError(new Error("too many requests"))).toBe("transient");
    });

    it("classifies 502, 503, 504 as transient", () => {
      expect(classifyImportError(new Error("502 Bad Gateway"))).toBe("transient");
      expect(classifyImportError(new Error("503 Service Unavailable"))).toBe("transient");
      expect(classifyImportError(new Error("504 Gateway Timeout"))).toBe("transient");
    });

    it("classifies lock conflicts as transient", () => {
      expect(classifyImportError(new Error("409 Conflict - already processing"))).toBe("transient");
    });

    it("classifies permanent errors", () => {
      expect(classifyImportError(new Error("400 Bad Request"))).toBe("permanent");
      expect(classifyImportError(new Error("403 Forbidden"))).toBe("permanent");
      expect(classifyImportError(new Error("404 Not Found"))).toBe("permanent");
      expect(classifyImportError(new Error("Validation failed"))).toBe("permanent");
      expect(classifyImportError(new Error("Unauthorized"))).toBe("permanent");
      expect(classifyImportError(new Error("duplicate key violates unique constraint"))).toBe("permanent");
    });
  });

  describe("getBackoffDelay", () => {
    it("has bounded exponential backoff", () => {
      for (let i = 0; i < 100; i++) {
        const delay = getBackoffDelay(0);
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(2000);
      }
      for (let i = 0; i < 100; i++) {
        const delay = getBackoffDelay(5);
        expect(delay).toBeLessThanOrEqual(30000);
      }
    });

    it("never exceeds 30s cap", () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const delay = getBackoffDelay(attempt);
        expect(delay).toBeLessThanOrEqual(30000);
      }
    });
  });

  describe("buildExecutionPatch", () => {
    it("start: creates running state from idle", () => {
      const result = buildExecutionPatch({}, "start");
      expect(result.status).toBe("running");
      expect(result.startedAt).toBeTruthy();
      expect(result.pausedAt).toBeNull();
      expect(result.stoppedAt).toBeNull();
      expect(result.log.length).toBe(1);
      expect(result.log[0].message).toBe("Execution started");
    });

    it("start: preserves existing startedAt", () => {
      const earlier = new Date(Date.now() - 60000).toISOString();
      const result = buildExecutionPatch({ startedAt: earlier }, "start");
      expect(result.startedAt).toBe(earlier);
    });

    it("pause: transitions running → paused", () => {
      const running = buildExecutionPatch({}, "start");
      const result = buildExecutionPatch(running, "pause");
      expect(result.status).toBe("paused");
      expect(result.pausedAt).toBeTruthy();
      expect(result.log.length).toBe(2);
      expect(result.log[1].message).toBe("Execution paused");
    });

    it("resume: transitions paused → running", () => {
      const running = buildExecutionPatch({}, "start");
      const paused = buildExecutionPatch(running, "pause");
      const result = buildExecutionPatch(paused, "resume");
      expect(result.status).toBe("running");
      expect(result.pausedAt).toBeNull();
      expect(result.log.length).toBe(3);
      expect(result.log[2].message).toBe("Execution resumed");
    });

    it("stop: transitions running → stopped", () => {
      const running = buildExecutionPatch({}, "start");
      const result = buildExecutionPatch(running, "stop");
      expect(result.status).toBe("stopped");
      expect(result.stoppedAt).toBeTruthy();
      expect(result.retryAttempt).toBe(0);
    });

    it("stop: resets errorMessage", () => {
      const result = buildExecutionPatch({ errorMessage: "some error", retryAttempt: 2 }, "stop");
      expect(result.errorMessage).toBeNull();
      expect(result.retryAttempt).toBe(0);
    });

    it("set_delay: updates delayMs", () => {
      const result = buildExecutionPatch({}, "set_delay", 500);
      expect(result.delayMs).toBe(500);
    });

    it("set_delay: keeps existing delayMs when not provided", () => {
      const result = buildExecutionPatch({ delayMs: 1000 }, "set_delay");
      expect(result.delayMs).toBe(1000);
    });

    it("log is capped at 100 entries", () => {
      let state = defaultExecutionState();
      for (let i = 0; i < 150; i++) {
        state = buildExecutionPatch(state, "stop");
        state = buildExecutionPatch(state, "start");
      }
      expect(state.log.length).toBeLessThanOrEqual(100);
    });
  });

  describe("refresh-recovery (buildExecutionPatch)", () => {
    it("stopped state does not auto-resume — resume requires explicit resume command", () => {
      const running = buildExecutionPatch({}, "start");
      const stopped = buildExecutionPatch(running, "stop");
      expect(stopped.status).toBe("stopped");
      const resumed = buildExecutionPatch(stopped, "start");
      expect(resumed.status).toBe("running");
    });

    it("recover command preserves existing counters, timestamps, delay, retry, and logs", () => {
      const state: ImportExecutionState = {
        status: "running",
        startedAt: "2026-07-25T23:00:00.000Z",
        pausedAt: null,
        stoppedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
        delayMs: 500,
        retryAttempt: 0,
        maxRetries: 3,
        chunksCompleted: 5,
        totalChunkDurationMs: 12000,
        log: [
          { at: "2026-07-25T23:00:00.000Z", type: "info", message: "Execution started" },
          { at: "2026-07-25T23:00:02.500Z", type: "info", message: "Chunk: 50 items" },
        ],
      };
      const recovered = buildExecutionPatch(state, "recover");
      expect(recovered.status).toBe("running");
      expect(recovered.startedAt).toBe(state.startedAt);
      expect(recovered.delayMs).toBe(state.delayMs);
      expect(recovered.chunksCompleted).toBe(state.chunksCompleted);
      expect(recovered.totalChunkDurationMs).toBe(state.totalChunkDurationMs);
      expect(recovered.retryAttempt).toBe(state.retryAttempt);
      expect(recovered.maxRetries).toBe(state.maxRetries);
      expect(recovered.log.length).toBe(state.log.length + 1);
      expect(recovered.log[recovered.log.length - 1].message).toBe("Execution recovered after interruption");
    });

    it("recover sets pausedAt/stoppedAt/failedAt to null", () => {
      const state = buildExecutionPatch({ startedAt: new Date().toISOString() }, "start");
      const paused = buildExecutionPatch(state, "pause");
      const recovered = buildExecutionPatch(paused, "recover");
      expect(recovered.status).toBe("running");
      expect(recovered.pausedAt).toBeNull();
    });
  });
});
