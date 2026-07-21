/**
 * Admin-only server functions for the translation pipeline.
 * Every function chains `requireAdmin`, then delegates to the server-only
 * service which uses the admin client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin.middleware";

const runInput = z.object({ limit: z.number().int().min(1).max(50).optional() });

export const getTranslationPipelineStatus = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { getTranslationStatus } = await import("./service.server");
    return getTranslationStatus();
  });

export const listTranslationJobs = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { listRecentJobs } = await import("./service.server");
    return listRecentJobs(200);
  });

export const runTranslationJobs = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => runInput.parse(d))
  .handler(async ({ data }) => {
    const { runPendingJobs } = await import("./service.server");
    return runPendingJobs(data.limit ?? 5);
  });

export const enqueueAllTranslations = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { enqueueForAllBusinesses } = await import("./service.server");
    return enqueueForAllBusinesses(1000);
  });

export const enqueueBusinessTranslations = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ businessId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { enqueueMissingTranslations } = await import("./service.server");
    return enqueueMissingTranslations(data.businessId);
  });
