/**
 * Strict per-request-type field allowlists for owner change requests.
 * The SAME allowlist is enforced in the database RPC
 * (`_bcr_field_allowlist`) — this file exists so the client and server-fn
 * layers reject unknown fields early with typed errors.
 *
 * Any additional key MUST be added in both places.
 */
import { z } from "zod";

// ── business_fields ─────────────────────────────────────────
export const BUSINESS_FIELD_KEYS = [
  "name",
  "description",
  "phone",
  "international_phone",
  "email",
  "website",
  "formatted_address",
  "neighborhood",
  "price_level",
] as const;
export type BusinessFieldKey = (typeof BUSINESS_FIELD_KEYS)[number];

const priceLevel = z
  .union([z.literal(null), z.number().int().min(0).max(4)])
  .optional();
const phone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+()0-9 .-]*$/)
  .optional()
  .nullable();

export const businessFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional().nullable(),
    phone,
    international_phone: phone,
    email: z.string().trim().email().max(255).optional().nullable(),
    website: z.string().trim().url().max(500).optional().nullable(),
    formatted_address: z.string().trim().max(500).optional().nullable(),
    neighborhood: z.string().trim().max(200).optional().nullable(),
    price_level: priceLevel,
  })
  .strict();

export const categoryRequestSchema = z
  .object({
    primary_category_id: z.string().uuid().nullable(),
    category_ids: z.array(z.string().uuid()).max(8),
  })
  .strict()
  .refine(
    (v) => v.primary_category_id === null || v.category_ids.includes(v.primary_category_id),
    { message: "primary category must be included in category_ids" },
  );

// ── opening_hours ───────────────────────────────────────────
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
export const openingHoursSchema = z
  .object({
    hours: z
      .array(
        z.object({
          day_of_week: z.number().int().min(0).max(6),
          open_time: timeStr,
          close_time: timeStr,
          is_closed: z.boolean().default(false),
        }),
      )
      .max(21),
  })
  .strict();

// ── services ────────────────────────────────────────────────
export const servicesSchema = z
  .object({
    services: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(1000).optional().nullable(),
          price: z.number().finite().nonnegative().optional().nullable(),
        }),
      )
      .max(100),
  })
  .strict();

// ── attributes ──────────────────────────────────────────────
export const attributesSchema = z
  .object({
    attributes: z
      .array(
        z.object({
          key: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .regex(/^[a-z0-9_.-]+$/),
          value: z.any(),
        }),
      )
      .max(200),
  })
  .strict();

// ── translations ────────────────────────────────────────────
export const translationsSchema = z
  .object({
    translations: z
      .array(
        z.object({
          language: z.enum(["tr", "en", "ar"]),
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(4000).optional().nullable(),
        }),
      )
      .min(1)
      .max(3),
  })
  .strict();

// ── image_request ───────────────────────────────────────────
export const imageRequestSchema = z
  .object({
    cover_image_id: z.string().uuid().optional(),
    delete_image_ids: z.array(z.string().uuid()).max(50).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (v) => v.cover_image_id !== undefined || (v.delete_image_ids?.length ?? 0) > 0,
    { message: "empty image request" },
  );

export const REQUEST_TYPES = [
  "business_fields",
  "categories",
  "opening_hours",
  "services",
  "attributes",
  "translations",
  "image_request",
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export function schemaFor(type: RequestType) {
  switch (type) {
    case "business_fields":
      return businessFieldsSchema;
    case "categories":
      return categoryRequestSchema;
    case "opening_hours":
      return openingHoursSchema;
    case "services":
      return servicesSchema;
    case "attributes":
      return attributesSchema;
    case "translations":
      return translationsSchema;
    case "image_request":
      return imageRequestSchema;
  }
}
