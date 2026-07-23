/**
 * Supabase-backed repository implementations.
 * Satisfy the same interfaces as the demo repositories in `./index`.
 * All reads use the anon Data API client with RLS enforced.
 */
import { supabase } from "@/integrations/supabase/client";
import { searchPublishedBusinessesFn } from "@/lib/search/search.functions";
import type {
  Business,
  BusinessImage,
  BusinessService,
  Category,
  City,
  District,
  Locale,
  LocalizedString,
  OpeningHour,
  Review,
  SearchFilters,
  SearchResult,
} from "@/types/domain";
import { fixMojibake } from "@/lib/i18n";
import type {
  BusinessRepository,
  CategoryRepository,
  CityRepository,
  ReviewRepository,
} from "./types";

type TranslationRow = { language_code: string; name: string | null };

function toLocalizedString(rows: TranslationRow[] | null | undefined): LocalizedString {
  const out: LocalizedString = {};
  for (const r of rows ?? []) {
    if (r.language_code === "ar" || r.language_code === "en" || r.language_code === "tr") {
      out[r.language_code as Locale] = fixMojibake(r.name ?? "");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Categories

const CATEGORY_SELECT =
  "id, slug, icon, image_url, category_type, is_active, sort_order, category_translations(language_code, name)";

function mapCategory(row: any): Category {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    slug: row.slug,
    icon: row.icon,
    imageUrl: row.image_url,
    categoryType: row.category_type,
    name: toLocalizedString(row.category_translations),
    isActive: !!row.is_active,
    sortOrder: row.sort_order ?? 0,
  };
}

class SupabaseCategoryRepository implements CategoryRepository {
  async list(): Promise<Category[]> {
    const { data, error } = await supabase
      .from("categories")
      .select(CATEGORY_SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapCategory);
  }
  async getBySlug(slug: string): Promise<Category | null> {
    const { data, error } = await supabase
      .from("categories")
      .select(CATEGORY_SELECT)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    return data ? mapCategory(data) : null;
  }
  async getTopLevel(): Promise<Category[]> {
    return this.list();
  }
}

// ---------------------------------------------------------------------------
// Cities & districts

const CITY_SELECT =
  "id, country_id, slug, latitude, longitude, image_url, is_featured, is_active, sort_order, city_translations(language_code, name)";
const DISTRICT_SELECT =
  "id, city_id, slug, latitude, longitude, is_active, district_translations(language_code, name)";

function mapCity(row: any): City {
  return {
    id: row.id,
    countryId: row.country_id,
    slug: row.slug,
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    imageUrl: row.image_url ?? null,
    isFeatured: !!row.is_featured,
    isActive: !!row.is_active,
    sortOrder: row.sort_order ?? 0,
    name: toLocalizedString(row.city_translations),
  };
}
function mapDistrict(row: any): District {
  return {
    id: row.id,
    cityId: row.city_id,
    slug: row.slug,
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    isActive: !!row.is_active,
    name: toLocalizedString(row.district_translations),
  };
}

class SupabaseCityRepository implements CityRepository {
  async list(): Promise<City[]> {
    const { data, error } = await supabase
      .from("cities")
      .select(CITY_SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapCity);
  }
  async getBySlug(slug: string): Promise<City | null> {
    const { data, error } = await supabase
      .from("cities")
      .select(CITY_SELECT)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    return data ? mapCity(data) : null;
  }
  async getFeatured(limit = 6): Promise<City[]> {
    const { data, error } = await supabase
      .from("cities")
      .select(CITY_SELECT)
      .eq("is_active", true)
      .eq("is_featured", true)
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(mapCity);
  }
  async listDistricts(cityId: string): Promise<District[]> {
    const { data, error } = await supabase
      .from("districts")
      .select(DISTRICT_SELECT)
      .eq("city_id", cityId)
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map(mapDistrict);
  }
  async getDistrictBySlug(cityId: string, slug: string): Promise<District | null> {
    const { data, error } = await supabase
      .from("districts")
      .select(DISTRICT_SELECT)
      .eq("city_id", cityId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    return data ? mapDistrict(data) : null;
  }
}

// ---------------------------------------------------------------------------
// Businesses

const BUSINESS_SELECT = `
  id, place_id, name, slug, original_language, description,
  primary_category_id, city_id, district_id, formatted_address,
  latitude, longitude, phone, international_phone, email, website,
  google_maps_url, rating, review_count, price_level, status, source,
  is_featured, is_verified, owner_id, created_at, updated_at,
  city:cities!businesses_city_id_fkey(${CITY_SELECT}),
  district:districts!businesses_district_id_fkey(${DISTRICT_SELECT}),
  primary_category:categories!businesses_primary_category_id_fkey(${CATEGORY_SELECT}),
  business_category_links(category:categories(${CATEGORY_SELECT})),
  business_images_public(id, source_url, r2_url, storage_status, image_type, is_cover, sort_order, width, height),
  business_opening_hours(day_of_week, open_time, close_time, is_closed, raw_value, sort_order),
  business_services(service_key, value, sort_order),
  business_attributes(attribute_key, value, source),
  business_translations(language_code, translated_name, translated_description, translation_status)
`;

function normalizeLanguage(v: string | null | undefined): Locale {
  return v === "ar" || v === "en" || v === "tr" ? v : "tr";
}

function mapBusiness(row: any): Business {
  const orig = normalizeLanguage(row.original_language);

  // Description as LocalizedString: original language + approved translations
  const description: LocalizedString = {};
  if (row.description) description[orig] = fixMojibake(row.description);
  for (const t of row.business_translations ?? []) {
    if (
      t.translation_status === "approved" &&
      (t.language_code === "ar" || t.language_code === "en" || t.language_code === "tr") &&
      t.translated_description
    ) {
      description[t.language_code as Locale] = fixMojibake(t.translated_description);
    }
  }

  const categories: Category[] = (row.business_category_links ?? [])
    .map((l: any) => l.category)
    .filter(Boolean)
    .map(mapCategory);

  const primaryCategory: Category = row.primary_category
    ? mapCategory(row.primary_category)
    : (categories[0] ?? {
        id: row.primary_category_id ?? "",
        parentId: null,
        slug: "",
        icon: null,
        imageUrl: null,
        categoryType: null,
        name: {},
        isActive: true,
        sortOrder: 0,
      });

  const images: BusinessImage[] = (row.business_images_public ?? row.business_images ?? [])
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((im: any) => ({
      id: im.id,
      businessId: row.id,
      placeId: row.place_id,
      sourceUrl: im.source_url,
      r2Key: im.r2_key ?? null,
      r2Url: im.r2_url,
      storageStatus: im.storage_status,
      imageType: im.image_type,
      isCover: !!im.is_cover,
      sortOrder: im.sort_order ?? 0,
      width: im.width ?? undefined,
      height: im.height ?? undefined,
    }));

  const openingHours: OpeningHour[] = (row.business_opening_hours ?? [])
    .sort((a: any, b: any) => a.day_of_week - b.day_of_week)
    .map((h: any) => ({
      dayOfWeek: h.day_of_week,
      openTime: h.open_time ? String(h.open_time).slice(0, 5) : null,
      closeTime: h.close_time ? String(h.close_time).slice(0, 5) : null,
      isClosed: !!h.is_closed,
      rawValue: h.raw_value ?? undefined,
      sortOrder: h.sort_order ?? 0,
    }));

  const services: BusinessService[] = (row.business_services ?? []).map((s: any) => ({
    key: s.service_key,
    value: typeof s.value === "string" ? s.value : (s.value?.text ?? s.service_key),
    sortOrder: s.sort_order ?? 0,
  }));

  const attributes = (row.business_attributes ?? []).map((a: any) => ({
    key: a.attribute_key,
    value: a.value,
    source: a.source ?? undefined,
  }));

  const cityRow = row.city;
  const city: City = cityRow ? mapCity(cityRow) : ({} as City);
  const district: District | null = row.district ? mapDistrict(row.district) : null;

  return {
    id: row.id,
    placeId: row.place_id,
    name: fixMojibake(row.name),
    slug: row.slug,
    originalLanguage: orig,
    description,
    primaryCategory,
    categories: categories.length ? categories : [primaryCategory],
    city,
    district,
    address: fixMojibake(row.formatted_address ?? ""),
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    phone: row.phone ?? null,
    internationalPhone: row.international_phone ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    googleMapsUrl: row.google_maps_url ?? null,
    rating: Number(row.rating ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    priceLevel: (row.price_level ?? null) as Business["priceLevel"],
    status: row.status,
    source: row.source,
    isFeatured: !!row.is_featured,
    isVerified: !!row.is_verified,
    images,
    openingHours,
    services,
    attributes,
    ownerId: row.owner_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseBusinessRepository implements BusinessRepository {
  async list(filters: Partial<SearchFilters>): Promise<SearchResult> {
    return searchPublishedBusinessesFn({ data: filters });
  }

  async getBySlug(slug: string): Promise<Business | null> {
    const { data, error } = await supabase
      .from("businesses")
      .select(BUSINESS_SELECT)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (error) throw error;
    return data ? mapBusiness(data) : null;
  }

  async getFeatured(limit = 8): Promise<Business[]> {
    const { data, error } = await supabase
      .from("businesses")
      .select(BUSINESS_SELECT)
      .eq("status", "published")
      .eq("is_featured", true)
      .order("rating", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(mapBusiness);
  }

  async getByCategory(categorySlug: string, limit = 8): Promise<Business[]> {
    const result = await this.list({
      category: categorySlug,
      sort: "recommended",
      page: 1,
      pageSize: limit,
    });
    return result.items;
  }

  async getByCity(citySlug: string, limit = 8): Promise<Business[]> {
    const result = await this.list({
      city: citySlug,
      sort: "recommended",
      page: 1,
      pageSize: limit,
    });
    return result.items;
  }

  async getSimilar(business: Business, limit = 4): Promise<Business[]> {
    const orParts = [`primary_category_id.eq.${business.primaryCategory.id}`];
    if (business.city?.id) orParts.push(`city_id.eq.${business.city.id}`);
    const { data, error } = await supabase
      .from("businesses")
      .select(BUSINESS_SELECT)
      .eq("status", "published")
      .neq("id", business.id)
      .or(orParts.join(","))
      .order("rating", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(mapBusiness);
  }
}

class SupabaseReviewRepository implements ReviewRepository {
  async listForBusiness(businessId: string, limit = 10): Promise<Review[]> {
    const { data, error } = await supabase
      .from("reviews")
      .select(
        "id, business_id, external_review_id, user_id, source, author_name, author_avatar_url, rating, review_text, review_language, owner_reply, owner_reply_at, review_date, created_at",
      )
      .eq("business_id", businessId)
      .eq("status", "published")
      .order("review_date", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r): Review => ({
      id: r.id,
      businessId: r.business_id,
      externalReviewId: r.external_review_id ?? null,
      userId: r.user_id ?? null,
      source: (r.source === "google" ? "google" : "platform"),
      authorName: r.author_name ?? "",
      authorAvatarUrl: r.author_avatar_url ?? null,
      rating: r.rating,
      reviewText: r.review_text ?? "",
      reviewLanguage: (r.review_language ?? "tr") as Review["reviewLanguage"],
      ownerReply: r.owner_reply ?? null,
      ownerReplyAt: r.owner_reply_at ?? null,
      reviewDate: r.review_date ?? r.created_at,
      createdAt: r.created_at,
    }));
  }
}

export const supabaseServices = {
  businesses: new SupabaseBusinessRepository() as BusinessRepository,
  categories: new SupabaseCategoryRepository() as CategoryRepository,
  cities: new SupabaseCityRepository() as CityRepository,
  reviews: new SupabaseReviewRepository() as ReviewRepository,
};
