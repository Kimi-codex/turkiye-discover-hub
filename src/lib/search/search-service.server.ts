import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  SearchFilters,
  SearchResult,
} from "@/types/domain";
import { normalizePublicSearchFilters, sortColumn } from "./search-filters";

type TranslationRow = { language_code: string; name: string | null };

const CATEGORY_SELECT =
  "id, parent_id, slug, icon, image_url, category_type, is_active, sort_order, category_translations(language_code, name)";
const CITY_SELECT =
  "id, country_id, slug, latitude, longitude, image_url, is_featured, is_active, sort_order, city_translations(language_code, name)";
const DISTRICT_SELECT =
  "id, city_id, slug, latitude, longitude, is_active, district_translations(language_code, name)";

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

function toLocalizedString(rows: TranslationRow[] | null | undefined): LocalizedString {
  const out: LocalizedString = {};
  for (const r of rows ?? []) {
    if (r.language_code === "ar" || r.language_code === "en" || r.language_code === "tr") {
      out[r.language_code as Locale] = r.name ?? "";
    }
  }
  return out;
}

function normalizeLanguage(value: string | null | undefined): Locale {
  return value === "ar" || value === "en" || value === "tr" ? value : "tr";
}

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

function mapBusiness(row: any): Business {
  const originalLanguage = normalizeLanguage(row.original_language);
  const description: LocalizedString = {};
  if (row.description) description[originalLanguage] = row.description;
  for (const translation of row.business_translations ?? []) {
    if (
      translation.translation_status === "approved" &&
      (translation.language_code === "ar" ||
        translation.language_code === "en" ||
        translation.language_code === "tr") &&
      translation.translated_description
    ) {
      description[translation.language_code as Locale] = translation.translated_description;
    }
  }

  const categories: Category[] = (row.business_category_links ?? [])
    .map((link: any) => link.category)
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

  const images: BusinessImage[] = (row.business_images_public ?? [])
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((image: any) => ({
      id: image.id,
      businessId: row.id,
      placeId: row.place_id,
      sourceUrl: image.source_url,
      r2Key: null,
      r2Url: image.r2_url,
      storageStatus: image.storage_status,
      imageType: image.image_type,
      isCover: !!image.is_cover,
      sortOrder: image.sort_order ?? 0,
      width: image.width ?? undefined,
      height: image.height ?? undefined,
    }));

  const openingHours: OpeningHour[] = (row.business_opening_hours ?? [])
    .sort((a: any, b: any) => a.day_of_week - b.day_of_week)
    .map((hour: any) => ({
      dayOfWeek: hour.day_of_week,
      openTime: hour.open_time ? String(hour.open_time).slice(0, 5) : null,
      closeTime: hour.close_time ? String(hour.close_time).slice(0, 5) : null,
      isClosed: !!hour.is_closed,
      rawValue: hour.raw_value ?? undefined,
      sortOrder: hour.sort_order ?? 0,
    }));

  const services: BusinessService[] = (row.business_services ?? []).map((service: any) => ({
    key: service.service_key,
    value: typeof service.value === "string" ? service.value : (service.value?.text ?? service.service_key),
    sortOrder: service.sort_order ?? 0,
  }));

  return {
    id: row.id,
    placeId: row.place_id,
    name: row.name,
    slug: row.slug,
    originalLanguage,
    description,
    primaryCategory,
    categories: categories.length ? categories : [primaryCategory],
    city: row.city ? mapCity(row.city) : ({} as City),
    district: row.district ? mapDistrict(row.district) : null,
    address: row.formatted_address ?? "",
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
    attributes: (row.business_attributes ?? []).map((attribute: any) => ({
      key: attribute.attribute_key,
      value: attribute.value,
      source: attribute.source ?? undefined,
    })),
    ownerId: row.owner_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function idForSlug(table: "categories" | "cities" | "districts", slug: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from(table).select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function businessIdsForCategory(categoryId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("business_category_links")
    .select("business_id")
    .eq("category_id", categoryId)
    .range(0, 49999);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.business_id).filter(Boolean))];
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&").replace(/,/g, " ");
}

export async function searchPublishedBusinesses(filters: Partial<SearchFilters>): Promise<SearchResult> {
  const normalized = normalizePublicSearchFilters(filters);
  const pageSize = normalized.pageSize ?? 12;
  const page = normalized.page;
  const { column, ascending } = sortColumn(normalized.sort);

  let query = supabaseAdmin
    .from("businesses")
    .select(BUSINESS_SELECT, { count: "exact" })
    .eq("status", "published");

  if (normalized.query) {
    const pattern = `%${escapeLike(normalized.query)}%`;
    query = query.or(`name.ilike.${pattern},formatted_address.ilike.${pattern},slug.ilike.${pattern}`);
  }

  if (normalized.city) {
    const cityId = await idForSlug("cities", normalized.city);
    if (!cityId) return { items: [], total: 0, page, pageSize };
    query = query.eq("city_id", cityId);
  }

  if (normalized.district) {
    const districtId = await idForSlug("districts", normalized.district);
    if (!districtId) return { items: [], total: 0, page, pageSize };
    query = query.eq("district_id", districtId);
  }

  if (normalized.category) {
    const categoryId = await idForSlug("categories", normalized.category);
    if (!categoryId) return { items: [], total: 0, page, pageSize };
    const linkedBusinessIds = await businessIdsForCategory(categoryId);
    if (linkedBusinessIds.length === 0) {
      query = query.eq("primary_category_id", categoryId);
    } else {
      query = query.or(`primary_category_id.eq.${categoryId},id.in.(${linkedBusinessIds.join(",")})`);
    }
  }

  if (normalized.rating) query = query.gte("rating", normalized.rating);
  if (normalized.priceLevel) query = query.eq("price_level", normalized.priceLevel);

  query = query.order(column, { ascending, nullsFirst: false });

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;

  return {
    items: (data ?? []).map(mapBusiness),
    total: count ?? 0,
    page,
    pageSize,
  };
}
