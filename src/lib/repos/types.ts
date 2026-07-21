import type {
  Business,
  Category,
  City,
  District,
  Review,
  SearchFilters,
  SearchResult,
} from "@/types/domain";

/**
 * Repository interfaces — decoupled from any specific data source.
 *
 * Phase 1 ships in-memory demo implementations.
 * Phase 2 will add Supabase-backed implementations that satisfy the same
 * interfaces, so components need no changes.
 */

export interface BusinessRepository {
  list(filters: Partial<SearchFilters>): Promise<SearchResult>;
  getBySlug(slug: string): Promise<Business | null>;
  getFeatured(limit?: number): Promise<Business[]>;
  getByCategory(categorySlug: string, limit?: number): Promise<Business[]>;
  getByCity(citySlug: string, limit?: number): Promise<Business[]>;
  getSimilar(business: Business, limit?: number): Promise<Business[]>;
}

export interface CategoryRepository {
  list(): Promise<Category[]>;
  getBySlug(slug: string): Promise<Category | null>;
  getTopLevel(): Promise<Category[]>;
}

export interface CityRepository {
  list(): Promise<City[]>;
  getBySlug(slug: string): Promise<City | null>;
  getFeatured(limit?: number): Promise<City[]>;
  listDistricts(cityId: string): Promise<District[]>;
  getDistrictBySlug(cityId: string, slug: string): Promise<District | null>;
}

export interface ReviewRepository {
  listForBusiness(businessId: string, limit?: number): Promise<Review[]>;
}
