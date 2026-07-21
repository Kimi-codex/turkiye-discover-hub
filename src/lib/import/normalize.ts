/**
 * Pure normalizers for Google Places JSON → domain-shaped business rows.
 * No I/O. Deterministic. Missing place_id → invalid.
 */
import { createHash } from "crypto";

export interface NormalizedOpeningHour {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  rawValue?: string;
}

export interface NormalizedImage {
  sourceUrl: string;
  width?: number;
  height?: number;
  googleCategory:
    | "cover"
    | "exterior"
    | "interior"
    | "food"
    | "menu"
    | "product"
    | "logo"
    | "staff"
    | "other";
  googleLabels?: string[];
  sortOrder: number;
  isCover: boolean;
}

export interface NormalizedReview {
  externalReviewId: string | null;
  sourceFingerprint: string;
  authorName: string;
  authorAvatarUrl: string | null;
  rating: number;
  reviewText: string;
  reviewLanguage: string | null;
  reviewDate: string | null;
}

export interface NormalizedBusiness {
  placeId: string;
  name: string;
  originalLanguage: "ar" | "en" | "tr" | null;
  description: string | null;
  primaryCategorySource: string | null;
  categoriesSource: string[];
  cityHint: string | null;
  districtHint: string | null;
  formattedAddress: string | null;
  rawAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  internationalPhone: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  rating: number | null;
  reviewCount: number;
  priceLevel: 1 | 2 | 3 | 4 | null;
  openingHours: NormalizedOpeningHour[];
  images: NormalizedImage[];
  reviews: NormalizedReview[];
  popularTimes: unknown | null;
  sourceUpdatedAt: string | null;
  raw: Record<string, unknown>;
}

export function normalizePhone(input: unknown): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Keep leading +, strip everything else that isn't a digit
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 6) return null;
  return `${plus}${digits}`;
}

export function normalizeWebsite(input: unknown): string | null {
  if (!input || typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function normalizeCoordinates(
  raw: Record<string, unknown>,
): { lat: number | null; lng: number | null } {
  const g = raw.geometry as Record<string, unknown> | undefined;
  const loc = (g?.location ?? raw.location ?? raw.geometry) as
    | Record<string, unknown>
    | undefined;
  const lat = pickNumber(loc?.lat) ?? pickNumber(raw.latitude);
  const lng = pickNumber(loc?.lng) ?? pickNumber(loc?.lon) ?? pickNumber(raw.longitude);
  if (lat === null || lng === null) return { lat: null, lng: null };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { lat: null, lng: null };
  return { lat, lng };
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Google opening_hours.periods: [{ open:{day,time}, close:{day,time} }, …]
 * or opening_hours.weekday_text (fallback strings).
 * Google day: 0=Sunday..6=Saturday (matches JS Date.getDay()).
 */
export function normalizeOpeningHours(raw: Record<string, unknown>): NormalizedOpeningHour[] {
  const oh = (raw.opening_hours ?? raw.openingHours ?? raw.current_opening_hours) as
    | Record<string, unknown>
    | undefined;
  if (!oh) return [];
  const periods = oh.periods as Array<Record<string, unknown>> | undefined;
  const out: NormalizedOpeningHour[] = [];
  if (Array.isArray(periods)) {
    // Init 7 days closed
    for (let d = 0; d < 7; d++) {
      out.push({ dayOfWeek: d, openTime: null, closeTime: null, isClosed: true });
    }
    for (const p of periods) {
      const open = p.open as Record<string, unknown> | undefined;
      const close = p.close as Record<string, unknown> | undefined;
      const d = pickNumber(open?.day);
      if (d === null || d < 0 || d > 6) continue;
      const openT = fmtTime(open?.time);
      const closeT = fmtTime(close?.time);
      if (openT === null && !close) {
        // 24h open
        out[d] = { dayOfWeek: d, openTime: "00:00", closeTime: "23:59", isClosed: false };
        continue;
      }
      if (openT) {
        out[d] = { dayOfWeek: d, openTime: openT, closeTime: closeT, isClosed: false };
      }
    }
    return out;
  }
  const weekdayText = oh.weekday_text as string[] | undefined;
  if (Array.isArray(weekdayText)) {
    // Store raw only; parsing localized strings is unreliable
    return weekdayText.slice(0, 7).map((s, i) => ({
      dayOfWeek: (i + 1) % 7,
      openTime: null,
      closeTime: null,
      isClosed: /closed/i.test(s),
      rawValue: s,
    }));
  }
  return [];
}

function fmtTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.padStart(4, "0");
  if (!/^\d{4}$/.test(t)) return null;
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

/**
 * Classify a Google photo. Google returns `html_attributions`, sometimes
 * category hints in `types`, and in newer exports a `categories` array.
 * We conservatively bucket into cover/exterior/interior/food/menu/product/logo/staff/other.
 * The first image is NOT automatically the cover.
 */
export function classifyImage(photo: Record<string, unknown>): NormalizedImage["googleCategory"] {
  const cat =
    (photo.category as string | undefined) ||
    (photo.type as string | undefined) ||
    (Array.isArray(photo.categories) && (photo.categories[0] as string)) ||
    "";
  const label = cat.toLowerCase();
  if (/(^|_)cover(_|$)/.test(label)) return "cover";
  if (/food|dish|meal|drink|beverage|dessert/.test(label)) return "food";
  if (/menu/.test(label)) return "menu";
  if (/logo|brand/.test(label)) return "logo";
  if (/exterior|storefront|facade|outside/.test(label)) return "exterior";
  if (/interior|inside|room|hall/.test(label)) return "interior";
  if (/product|item|good/.test(label)) return "product";
  if (/staff|team|person|people/.test(label)) return "staff";
  return "other";
}

export function normalizeImages(raw: Record<string, unknown>): NormalizedImage[] {
  const photos = (raw.photos ?? raw.images) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(photos) || photos.length === 0) return [];
  const items: NormalizedImage[] = [];
  photos.forEach((p, i) => {
    const url =
      (typeof p.url === "string" && p.url) ||
      (typeof p.photo_reference === "string" && (p.photo_reference as string)) ||
      (typeof p.source === "string" && (p.source as string)) ||
      (typeof p.src === "string" && (p.src as string)) ||
      null;
    if (!url || !/^https?:\/\//i.test(url)) return;
    const googleCategory = classifyImage(p);
    const labels = Array.isArray(p.categories)
      ? (p.categories as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    items.push({
      sourceUrl: url,
      width: pickNumber(p.width) ?? undefined,
      height: pickNumber(p.height) ?? undefined,
      googleCategory,
      googleLabels: labels,
      sortOrder: i,
      isCover: false, // resolved after classification pass below
    });
  });
  // Choose cover: prefer explicit 'cover', else first 'exterior', else first 'interior',
  // else the largest image, else index 0. First image is NOT automatically the cover.
  if (items.length > 0) {
    const explicit = items.findIndex((i) => i.googleCategory === "cover");
    const exterior = items.findIndex((i) => i.googleCategory === "exterior");
    const interior = items.findIndex((i) => i.googleCategory === "interior");
    let coverIdx =
      explicit !== -1
        ? explicit
        : exterior !== -1
          ? exterior
          : interior !== -1
            ? interior
            : -1;
    if (coverIdx === -1) {
      // Fall back to largest by pixel area (width*height); then to index 0
      let bestArea = -1;
      let bestIdx = 0;
      items.forEach((it, i) => {
        const area = (it.width ?? 0) * (it.height ?? 0);
        if (area > bestArea) {
          bestArea = area;
          bestIdx = i;
        }
      });
      coverIdx = bestIdx;
    }
    items[coverIdx].isCover = true;
  }
  return items;
}

export function normalizeReviews(raw: Record<string, unknown>): NormalizedReview[] {
  const reviews = raw.reviews as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(reviews)) return [];
  const placeId = (raw.place_id as string) ?? "";
  return reviews
    .map((r) => {
      const rating = pickNumber(r.rating);
      if (rating === null) return null;
      const author = String(r.author_name ?? r.author ?? "").trim();
      const text = String(r.text ?? r.review_text ?? "").trim();
      const dateRaw =
        (r.time && typeof r.time === "number"
          ? new Date((r.time as number) * 1000).toISOString()
          : null) ??
        (typeof r.review_date === "string" ? r.review_date : null) ??
        (typeof r.date === "string" ? r.date : null) ??
        null;
      const external =
        (typeof r.review_id === "string" && r.review_id) ||
        (typeof r.id === "string" && r.id) ||
        null;
      const fingerprint = createHash("sha256")
        .update(`${placeId}|${author}|${dateRaw ?? ""}|${text.slice(0, 200)}`)
        .digest("hex");
      return {
        externalReviewId: external,
        sourceFingerprint: fingerprint,
        authorName: author || "Anonymous",
        authorAvatarUrl:
          (typeof r.profile_photo_url === "string" && r.profile_photo_url) ||
          (typeof r.author_avatar_url === "string" && r.author_avatar_url) ||
          null,
        rating: Math.max(1, Math.min(5, Math.round(rating))),
        reviewText: text,
        reviewLanguage: (typeof r.language === "string" && r.language) || null,
        reviewDate: dateRaw,
      } satisfies NormalizedReview;
    })
    .filter((x): x is NormalizedReview => x !== null);
}

export function normalizeCategory(raw: Record<string, unknown>): {
  primary: string | null;
  all: string[];
} {
  const types = (raw.types ?? raw.categories) as unknown;
  const list: string[] = [];
  if (Array.isArray(types)) {
    for (const t of types) if (typeof t === "string" && t.trim()) list.push(t.trim().toLowerCase());
  }
  const primary =
    (typeof raw.primary_category === "string" && (raw.primary_category as string).toLowerCase()) ||
    list[0] ||
    null;
  return { primary, all: dedupe(list) };
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export function normalizeAddress(raw: Record<string, unknown>): {
  formattedAddress: string | null;
  rawAddress: string | null;
  cityHint: string | null;
  districtHint: string | null;
} {
  const formatted =
    (typeof raw.formatted_address === "string" && raw.formatted_address) ||
    (typeof raw.address === "string" && raw.address) ||
    null;
  const rawAddress = (typeof raw.vicinity === "string" && raw.vicinity) || null;
  const components = raw.address_components as Array<Record<string, unknown>> | undefined;
  let city: string | null = null;
  let district: string | null = null;
  if (Array.isArray(components)) {
    for (const c of components) {
      const types = c.types as string[] | undefined;
      const long = (c.long_name as string) ?? (c.short_name as string) ?? null;
      if (!types || !long) continue;
      if (types.includes("administrative_area_level_1") && !city) city = long;
      if (types.includes("locality") && !city) city = long;
      if (types.includes("administrative_area_level_2") && !district) district = long;
      if (types.includes("sublocality") && !district) district = long;
    }
  }
  return { formattedAddress: formatted, rawAddress, cityHint: city, districtHint: district };
}

export function normalizeGooglePlace(raw: Record<string, unknown>): NormalizedBusiness | null {
  const placeId = String(raw.place_id ?? raw.placeId ?? "").trim();
  if (!placeId) return null;
  const name = String(raw.name ?? "").trim();
  const { lat, lng } = normalizeCoordinates(raw);
  const { primary, all } = normalizeCategory(raw);
  const addr = normalizeAddress(raw);
  const originalLang =
    typeof raw.language === "string" && ["ar", "en", "tr"].includes(raw.language)
      ? (raw.language as "ar" | "en" | "tr")
      : null;
  const priceLevel =
    typeof raw.price_level === "number" && [1, 2, 3, 4].includes(raw.price_level)
      ? (raw.price_level as 1 | 2 | 3 | 4)
      : null;
  const reviewCount = Math.max(0, Math.floor(pickNumber(raw.user_ratings_total) ?? 0));
  const rating = pickNumber(raw.rating);

  const sourceUpdatedAt =
    (typeof raw.updated_at === "string" && raw.updated_at) ||
    (typeof raw.scraped_at === "string" && raw.scraped_at) ||
    null;

  return {
    placeId,
    name: name || "(unnamed)",
    originalLanguage: originalLang,
    description:
      (typeof raw.editorial_summary === "object" &&
        raw.editorial_summary &&
        typeof (raw.editorial_summary as Record<string, unknown>).overview === "string" &&
        ((raw.editorial_summary as Record<string, unknown>).overview as string)) ||
      (typeof raw.description === "string" && raw.description) ||
      null,
    primaryCategorySource: primary,
    categoriesSource: all,
    cityHint: addr.cityHint,
    districtHint: addr.districtHint,
    formattedAddress: addr.formattedAddress,
    rawAddress: addr.rawAddress,
    latitude: lat,
    longitude: lng,
    phone: normalizePhone(raw.formatted_phone_number ?? raw.phone),
    internationalPhone: normalizePhone(raw.international_phone_number),
    website: normalizeWebsite(raw.website ?? raw.url),
    googleMapsUrl:
      (typeof raw.url === "string" && raw.url.includes("google.com/maps") && raw.url) ||
      (typeof raw.google_maps_url === "string" && raw.google_maps_url) ||
      null,
    rating: rating !== null ? Math.max(0, Math.min(5, rating)) : null,
    reviewCount,
    priceLevel,
    openingHours: normalizeOpeningHours(raw),
    images: normalizeImages(raw),
    reviews: normalizeReviews(raw),
    popularTimes: (raw.popular_times ?? raw.populartimes ?? null) as unknown,
    sourceUpdatedAt,
    raw,
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateNormalizedBusiness(n: NormalizedBusiness | null): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!n) {
    return { ok: false, errors: ["missing_place_id"], warnings };
  }
  if (!n.placeId) errors.push("missing_place_id");
  if (!n.name || n.name === "(unnamed)") warnings.push("missing_name");
  if (n.latitude === null || n.longitude === null) warnings.push("missing_coordinates");
  if (!n.cityHint) warnings.push("missing_city_hint");
  if (!n.primaryCategorySource) warnings.push("missing_primary_category");
  if (n.images.length === 0) warnings.push("no_images");
  return { ok: errors.length === 0, errors, warnings };
}
