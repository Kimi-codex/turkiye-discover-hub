import { describe, expect, it } from "vitest";

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
  businessesProcessed: number;
  businessesTotal: number;
  businessesFailed: number;
  descriptionsGenerated: number;
  seoGenerated: number;
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
    businessesProcessed: 0,
    businessesTotal: 0,
    businessesFailed: 0,
    descriptionsGenerated: 0,
    seoGenerated: 0,
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

describe("enrichment state", () => {
  it("returns default state", () => {
    const s = defaultEnrichmentState();
    expect(s.status).toBe("idle");
    expect(s.delayMs).toBe(500);
    expect(s.businessesProcessed).toBe(0);
    expect(s.descriptionsGenerated).toBe(0);
    expect(s.seoGenerated).toBe(0);
  });

  it("start transitions to running and sets startedAt", () => {
    const patch = buildEnrichmentPatch({}, "start");
    expect(patch.status).toBe("running");
    expect(patch.startedAt).toBeTruthy();
    expect(patch.pausedAt).toBeNull();
    expect(patch.failedAt).toBeNull();
  });

  it("pause transitions to paused", () => {
    const running = buildEnrichmentPatch({}, "start");
    const patch = buildEnrichmentPatch(running as unknown as Record<string, unknown>, "pause");
    expect(patch.status).toBe("paused");
    expect(patch.pausedAt).toBeTruthy();
  });

  it("resume transitions to running without changing startedAt", () => {
    const running = buildEnrichmentPatch({}, "start");
    const paused = buildEnrichmentPatch(running as unknown as Record<string, unknown>, "pause");
    const patch = buildEnrichmentPatch(paused as unknown as Record<string, unknown>, "resume");
    expect(patch.status).toBe("running");
    expect(patch.startedAt).toBe(running.startedAt);
    expect(patch.pausedAt).toBeNull();
  });

  it("stop transitions to stopped and resets retryAttempt", () => {
    const still = { ...defaultEnrichmentState(), status: "running" as const, retryAttempt: 2 };
    const patch = buildEnrichmentPatch(still as unknown as Record<string, unknown>, "stop");
    expect(patch.status).toBe("stopped");
    expect(patch.stoppedAt).toBeTruthy();
    expect(patch.retryAttempt).toBe(0);
  });

  it("set_delay updates delayMs", () => {
    const patch = buildEnrichmentPatch({}, "set_delay", 1500);
    expect(patch.delayMs).toBe(1500);
  });

  it("set_delay without delayMs keeps existing", () => {
    const still = { ...defaultEnrichmentState(), delayMs: 999 };
    const patch = buildEnrichmentPatch(still as unknown as Record<string, unknown>, "set_delay");
    expect(patch.delayMs).toBe(999);
  });

  it("recover resets paused/stopped/failed and sets running", () => {
    const still = {
      ...defaultEnrichmentState(),
      status: "running" as const,
      pausedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    };
    const patch = buildEnrichmentPatch(still as unknown as Record<string, unknown>, "recover");
    expect(patch.status).toBe("running");
    expect(patch.pausedAt).toBeNull();
    expect(patch.stoppedAt).toBeNull();
    expect(patch.failedAt).toBeNull();
  });

  it("logs are capped at 100 entries (99 existing + 1 new)", () => {
    const existing = defaultEnrichmentState();
    existing.log = Array.from({ length: 99 }, (_, i) => ({
      at: new Date().toISOString(),
      type: "info" as const,
      message: `entry ${i}`,
    }));
    const patch = buildEnrichmentPatch(existing as unknown as Record<string, unknown>, "start");
    expect(patch.log.length).toBe(100);
    expect(patch.log[99].message).toBe("Enrichment started");
  });

  it("preserves businessesProcessed/seoGenerated when pausing", () => {
    const still = {
      ...defaultEnrichmentState(),
      status: "running" as const,
      businessesProcessed: 15,
      businessesTotal: 50,
      descriptionsGenerated: 8,
      seoGenerated: 24,
    };
    const patch = buildEnrichmentPatch(still as unknown as Record<string, unknown>, "pause");
    expect(patch.businessesProcessed).toBe(15);
    expect(patch.descriptionsGenerated).toBe(8);
    expect(patch.seoGenerated).toBe(24);
  });
});
