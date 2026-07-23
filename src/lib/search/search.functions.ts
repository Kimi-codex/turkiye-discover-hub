import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { searchPublishedBusinesses } from "./search-service.server";

const sortSchema = z.enum([
  "recommended",
  "highest_rated",
  "most_reviewed",
  "recently_added",
  "name",
]);

const searchFiltersSchema = z.object({
  query: z.string().max(160).optional().default(""),
  category: z.string().max(120).nullable().optional().default(null),
  city: z.string().max(120).nullable().optional().default(null),
  district: z.string().max(120).nullable().optional().default(null),
  rating: z.number().nullable().optional().default(null),
  openNow: z.boolean().optional().default(false),
  priceLevel: z.number().nullable().optional().default(null),
  sort: sortSchema.optional().default("recommended"),
  page: z.number().optional().default(1),
  pageSize: z.number().optional(),
});

export const searchPublishedBusinessesFn = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => searchFiltersSchema.parse(input ?? {}))
  .handler(async ({ data }) => searchPublishedBusinesses(data));
