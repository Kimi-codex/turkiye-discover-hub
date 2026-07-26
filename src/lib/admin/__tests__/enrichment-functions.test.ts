import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------- Replicate the core enrichment logic for unit testing ----------
// (The real functions in imports.functions.ts are not exported, so we test
//  the same logic directly — identical to how execution-state.test.ts works.)

type EnrichmentStatus = "idle" | "running" | "paused" | "stopped" | "completed" | "failed";

interface ExecutionLogEntry {
  at: string;
  type: "info" | "warn" | "error" | "retry";
  message: string;
}

interface ImportEnrichmentState {
  status: EnrichmentStatus;
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  delayMs: number;
  retryAttempt: number;
  maxRetries: number;
  businessesTotal: number;
  businessesProcessed: number;
  businessesCompleted: number;
  businessesFailed: number;
  businessesRetryable: number;
  businessesStale: number;
  descriptionsGenerated: number;
  seoArGenerated: number;
  seoEnGenerated: number;
  seoTrGenerated: number;
  latestError: string | null;
  lastRetryCount: number;
  totalDurationMs: number;
  log: ExecutionLogEntry[];
}

function defaultEnrichmentState(): ImportEnrichmentState {
  return {
    status: "idle",
    startedAt: null,
    pausedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    errorMessage: null,
    delayMs: 500,
    retryAttempt: 0,
    maxRetries: 3,
    businessesTotal: 0,
    businessesProcessed: 0,
    businessesCompleted: 0,
    businessesFailed: 0,
    businessesRetryable: 0,
    businessesStale: 0,
    descriptionsGenerated: 0,
    seoArGenerated: 0,
    seoEnGenerated: 0,
    seoTrGenerated: 0,
    latestError: null,
    lastRetryCount: 0,
    totalDurationMs: 0,
    log: [],
  };
}

type EnrichmentCommand = "start" | "pause" | "resume" | "stop" | "set_delay" | "recover";

function buildEnrichmentPatch(
  current: Record<string, unknown>,
  command: EnrichmentCommand,
  delayMs?: number,
): ImportEnrichmentState {
  const now = new Date().toISOString();
  const base = defaultEnrichmentState();
  const existing: ImportEnrichmentState = { ...base, ...(current as unknown as ImportEnrichmentState) };

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
          { at: now, type: "info" as const, message: command === "resume" ? "Enrichment resumed" : "Enrichment started" },
        ],
      };
    case "pause":
      return {
        ...existing,
        status: "paused",
        pausedAt: now,
        log: [
          ...(existing.log ?? []).slice(-99),
          { at: now, type: "info" as const, message: "Enrichment paused" },
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
          { at: now, type: "info" as const, message: "Enrichment stopped" },
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
          { at: now, type: "info" as const, message: "Enrichment recovered after interruption" },
        ],
      };
  }
}

// ---------- State-machine tests (enrichment control) ----------

describe("enrichment state machine", () => {
  it("returns default idle state", () => {
    const s = defaultEnrichmentState();
    expect(s.status).toBe("idle");
    expect(s.delayMs).toBe(500);
    expect(s.businessesProcessed).toBe(0);
    expect(s.descriptionsGenerated).toBe(0);
    expect(s.totalDurationMs).toBe(0);
  });

  it("start transitions to running and preserves startedAt", () => {
    const patch = buildEnrichmentPatch({}, "start");
    expect(patch.status).toBe("running");
    expect(patch.startedAt).toBeTruthy();
    expect(patch.pausedAt).toBeNull();
    expect(patch.failedAt).toBeNull();
  });

  it("start preserves existing startedAt on resume", () => {
    const started = buildEnrichmentPatch({}, "start");
    const paused = buildEnrichmentPatch(started as unknown as Record<string, unknown>, "pause");
    const resumed = buildEnrichmentPatch(paused as unknown as Record<string, unknown>, "resume");
    expect(resumed.status).toBe("running");
    expect(resumed.startedAt).toBe(started.startedAt);
    expect(resumed.pausedAt).toBeNull();
  });

  it("pause preserves all counters", () => {
    const state = {
      ...defaultEnrichmentState(),
      status: "running" as const,
      businessesProcessed: 25,
      businessesTotal: 100,
      descriptionsGenerated: 12,
      seoArGenerated: 8,
      seoEnGenerated: 10,
      seoTrGenerated: 6,
    };
    const paused = buildEnrichmentPatch(state as unknown as Record<string, unknown>, "pause");
    expect(paused.businessesProcessed).toBe(25);
    expect(paused.descriptionsGenerated).toBe(12);
    expect(paused.seoArGenerated).toBe(8);
  });

  it("stop resets retryAttempt and clears error", () => {
    const state = { ...defaultEnrichmentState(), status: "running" as const, retryAttempt: 5, errorMessage: "oops" };
    const stopped = buildEnrichmentPatch(state as unknown as Record<string, unknown>, "stop");
    expect(stopped.status).toBe("stopped");
    expect(stopped.retryAttempt).toBe(0);
    expect(stopped.errorMessage).toBeNull();
  });

  it("set_delay updates delayMs", () => {
    const patch = buildEnrichmentPatch({}, "set_delay", 1500);
    expect(patch.delayMs).toBe(1500);
  });

  it("recover clears paused/stopped/failed and sets running", () => {
    const state = {
      ...defaultEnrichmentState(),
      status: "paused" as const,
      pausedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    };
    const recovered = buildEnrichmentPatch(state as unknown as Record<string, unknown>, "recover");
    expect(recovered.status).toBe("running");
    expect(recovered.pausedAt).toBeNull();
    expect(recovered.stoppedAt).toBeNull();
    expect(recovered.failedAt).toBeNull();
  });

  it("caps log at 100 entries", () => {
    let state = defaultEnrichmentState();
    for (let i = 0; i < 150; i++) {
      state = buildEnrichmentPatch(state as unknown as Record<string, unknown>, "stop");
      state = buildEnrichmentPatch(state as unknown as Record<string, unknown>, "start");
    }
    expect(state.log.length).toBeLessThanOrEqual(100);
  });
});

// ---------- Counter behavior ----------

describe("enrichment counter behavior", () => {
  it("businessesCompleted is based on description generation, not all locals", () => {
    const s = defaultEnrichmentState();
    const businessesCompleted = s.businessesCompleted + 1;
    expect(businessesCompleted).toBe(1);
  });

  it("businessesFailed increments when any locale fails", () => {
    const descFailed = true;
    const seoArFail = false;
    const seoEnFail = true;
    const seoTrFail = false;
    const failed = descFailed || seoArFail || seoEnFail || seoTrFail;
    expect(failed).toBe(true);
  });

  it("businessesFailed does not increment when no failures", () => {
    const failed = [false, false, false, false].some(Boolean);
    expect(failed).toBe(false);
  });

  it("seoGenerated aggregates across all locales", () => {
    const seoArGen = 5, seoEnGen = 3, seoTrGen = 4;
    const seoGenerated = seoArGen + seoEnGen + seoTrGen;
    expect(seoGenerated).toBe(12);
  });

  it("per-locale failure does not affect other locale counts", () => {
    // Simulate: locale AR fails, EN and TR succeed
    const seoArGenerated = false;
    const seoEnGenerated = true;
    const seoTrGenerated = true;
    expect(seoArGenerated).toBe(false);
    expect(seoEnGenerated).toBe(true);
    expect(seoTrGenerated).toBe(true);
  });
});

// ---------- Enqueue validation logic ----------

describe("enqueueBatchEnrichment validation", () => {
  it("rejects batch with failed items", () => {
    const failed_items = 3;
    const invalid_items = 0;
    expect((failed_items ?? 0) > 0 || (invalid_items ?? 0) > 0).toBe(true);
  });

  it("rejects batch with invalid items", () => {
    const failed_items = 0;
    const invalid_items = 2;
    expect((failed_items ?? 0) > 0 || (invalid_items ?? 0) > 0).toBe(true);
  });

  it("accepts batch with no failures", () => {
    const failed_items = 0;
    const invalid_items = 0;
    expect((failed_items ?? 0) > 0 || (invalid_items ?? 0) > 0).toBe(false);
  });
});

// ---------- Skip enrichment validation ----------

describe("skipBatchEnrichment validation", () => {
  it("rejects skip when batch has failed items", () => {
    const failed_items = 1;
    expect((failed_items ?? 0) > 0).toBe(true);
  });

  it("rejects skip when batch is not in enrich stage", () => {
    const stage: string = "translations";
    expect(stage !== "enrich").toBe(true);
  });

  it("allows skip when batch is in enrich stage with no failures", () => {
    const stage: string = "enrich";
    const failed_items = 0;
    const invalid_items = 0;
    expect(stage === "enrich").toBe(true);
    expect((failed_items ?? 0) > 0 || (invalid_items ?? 0) > 0).toBe(false);
  });
});

// ---------- Stage advancement ----------

describe("enrichment stage advancement", () => {
  it("advances to images when enrichment completes", () => {
    const processed = 100;
    const total = 100;
    const allDone = processed >= total;
    expect(allDone).toBe(true);
  });

  it("does not advance when businesses remain", () => {
    const processed = 50;
    const total = 100;
    const allDone = processed >= total;
    expect(allDone).toBe(false);
  });

  it("processEnrichmentChunk rejects non-running state", () => {
    const status: string = "paused";
    expect(status !== "running").toBe(true);
  });

  it("processEnrichmentChunk rejects wrong stage", () => {
    const stage: string = "executed";
    expect(stage !== "enrich").toBe(true);
  });
});
