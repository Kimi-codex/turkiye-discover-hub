/**
 * Domain models for the directory platform.
 * These match the Phase 2 database schema so components never change
 * when demo repositories are swapped for real Supabase repositories.
 */

export type Locale = "ar" | "en" | "tr";
export const LOCALES: Locale[] = ["ar", "en", "tr"];
export const DEFAULT_LOCALE: Locale = "tr";
export const FALLBACK_LOCALE: Locale = "en";
export const RTL_LOCALES: Locale[] = ["ar"];

export type LocalizedString = Partial<Record<Locale, string>>;

export type BusinessStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "hidden"
  | "rejected";

export type ImageStorageStatus =
  | "pending"
  | "processing"
  | "uploaded"
  | "failed"
  | "external_only";

export type ImageType = "cover" | "gallery" | "logo" | "review";

export type ReviewSource = "google" | "platform";
export type BusinessSource = "google_json" | "manual" | "owner";

export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  icon: string | null;
  imageUrl: string | null;
  categoryType: string | null;
  name: LocalizedString;
  description?: LocalizedString;
  businessCount?: number;
  isActive: boolean;
  sortOrder: number;
}

export interface City {
  id: string;
  countryId: string;
  slug: string;
  latitude: number;
  longitude: number;
  imageUrl: string | null;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  name: LocalizedString;
  description?: LocalizedString;
  businessCount?: number;
}

export interface District {
  id: string;
  cityId: string;
  slug: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  name: LocalizedString;
}

export interface BusinessImage {
  id: string;
  businessId: string;
  placeId: string;
  sourceUrl: string | null;
  r2Key: string | null;
  r2Url: string | null;
  storageStatus: ImageStorageStatus;
  imageType: ImageType;
  isCover: boolean;
  sortOrder: number;
  width?: number;
  height?: number;
  alt?: string;
}

export interface OpeningHour {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  openTime: string | null; // "HH:mm"
  closeTime: string | null;
  isClosed: boolean;
  rawValue?: string;
  sortOrder: number;
}

export interface BusinessAttribute {
  key: string;
  value: string | number | boolean | null;
  source?: string;
}

export interface BusinessService {
  key: string;
  value: string;
  sortOrder: number;
}

export type PriceLevel = 1 | 2 | 3 | 4 | null;

export interface Business {
  id: string;
  placeId: string;
  name: string;
  slug: string;
  originalLanguage: Locale;
  description: LocalizedString;
  primaryCategory: Category;
  categories: Category[];
  city: City;
  district: District | null;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  internationalPhone?: string | null;
  email?: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  rating: number;
  reviewCount: number;
  priceLevel: PriceLevel;
  status: BusinessStatus;
  source?: BusinessSource;
  isFeatured: boolean;
  isVerified: boolean;
  images: BusinessImage[];
  openingHours: OpeningHour[];
  services: BusinessService[];
  attributes: BusinessAttribute[];
  ownerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  businessId: string;
  source: ReviewSource;
  externalReviewId?: string | null;
  userId?: string | null;
  authorName: string;
  authorAvatarUrl?: string | null;
  rating: number;
  reviewText: string;
  reviewLanguage: Locale | string;
  ownerReply?: string | null;
  ownerReplyAt?: string | null;
  reviewDate: string;
  createdAt: string;
}

export type SortOption =
  | "recommended"
  | "highest_rated"
  | "most_reviewed"
  | "recently_added"
  | "name";

export interface SearchFilters {
  query: string;
  category: string | null;
  city: string | null;
  district: string | null;
  rating: number | null;
  openNow: boolean;
  priceLevel: number | null;
  sort: SortOption;
  page: number;
}

export interface SearchResult {
  items: Business[];
  total: number;
  page: number;
  pageSize: number;
}

/** Reserved top-level slugs that are NOT category or city slugs. */
export const RESERVED_LANG_CHILD_SLUGS = new Set<string>([
  "search",
  "place",
  "auth",
  "admin",
  "dashboard",
  "api",
  "favorites",
  "account",
  "signin",
  "signup",
  "list-your-business",
]);
