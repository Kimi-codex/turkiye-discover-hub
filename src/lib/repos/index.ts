import type {
  Business,
  Category,
  City,
  District,
  Review,
  SearchFilters,
  SearchResult,
  SortOption,
} from "@/types/domain";
import type {
  BusinessRepository,
  CategoryRepository,
  CityRepository,
  ReviewRepository,
} from "./types";
import { BUSINESSES, CATEGORIES, CITIES, DISTRICTS, REVIEWS } from "./demo-data";

// -----------------------------------------------------------------------------

class DemoCategoryRepository implements CategoryRepository {
  async list(): Promise<Category[]> {
    return CATEGORIES.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async getBySlug(slug: string): Promise<Category | null> {
    return CATEGORIES.find((c) => c.slug === slug) ?? null;
  }
  async getTopLevel(): Promise<Category[]> {
    return (await this.list()).filter((c) => c.parentId === null);
  }
}

class DemoCityRepository implements CityRepository {
  async list(): Promise<City[]> {
    return CITIES.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async getBySlug(slug: string): Promise<City | null> {
    return CITIES.find((c) => c.slug === slug) ?? null;
  }
  async getFeatured(limit = 6): Promise<City[]> {
    return (await this.list()).filter((c) => c.isFeatured).slice(0, limit);
  }
  async listDistricts(cityId: string): Promise<District[]> {
    return DISTRICTS.filter((d) => d.cityId === cityId);
  }
  async getDistrictBySlug(cityId: string, slug: string): Promise<District | null> {
    return DISTRICTS.find((d) => d.cityId === cityId && d.slug === slug) ?? null;
  }
}

class DemoBusinessRepository implements BusinessRepository {
  async list(filters: Partial<SearchFilters>): Promise<SearchResult> {
    const pageSize = 12;
    const page = Math.max(1, filters.page ?? 1);
    let items = BUSINESSES.filter((b) => b.status === "published");

    if (filters.query) {
      const q = filters.query.toLowerCase();
      items = items.filter((b) => {
        const nameHit = b.name.toLowerCase().includes(q);
        const catHit = b.categories.some((c) =>
          Object.values(c.name).some((n) => n?.toLowerCase().includes(q)),
        );
        const cityHit = Object.values(b.city.name).some((n) =>
          n?.toLowerCase().includes(q),
        );
        const svcHit = b.services.some((s) => s.value.toLowerCase().includes(q));
        return nameHit || catHit || cityHit || svcHit;
      });
    }
    if (filters.category) {
      items = items.filter((b) => b.categories.some((c) => c.slug === filters.category));
    }
    if (filters.city) {
      items = items.filter((b) => b.city.slug === filters.city);
    }
    if (filters.district) {
      items = items.filter((b) => b.district?.slug === filters.district);
    }
    if (filters.rating) {
      items = items.filter((b) => b.rating >= (filters.rating as number));
    }
    if (filters.priceLevel) {
      items = items.filter((b) => b.priceLevel === filters.priceLevel);
    }
    if (filters.openNow) {
      const nowD = new Date();
      const day = nowD.getDay();
      const hhmm = `${String(nowD.getHours()).padStart(2, "0")}:${String(
        nowD.getMinutes(),
      ).padStart(2, "0")}`;
      items = items.filter((b) => {
        const h = b.openingHours.find((x) => x.dayOfWeek === day);
        if (!h || h.isClosed || !h.openTime || !h.closeTime) return false;
        return hhmm >= h.openTime && hhmm <= h.closeTime;
      });
    }

    items = sortBusinesses(items, filters.sort ?? "recommended");

    const total = items.length;
    const start = (page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    };
  }

  async getBySlug(slug: string): Promise<Business | null> {
    return BUSINESSES.find((b) => b.slug === slug && b.status === "published") ?? null;
  }

  async getFeatured(limit = 8): Promise<Business[]> {
    return BUSINESSES.filter((b) => b.isFeatured && b.status === "published").slice(
      0,
      limit,
    );
  }

  async getByCategory(categorySlug: string, limit = 8): Promise<Business[]> {
    return BUSINESSES.filter(
      (b) =>
        b.status === "published" && b.categories.some((c) => c.slug === categorySlug),
    ).slice(0, limit);
  }

  async getByCity(citySlug: string, limit = 8): Promise<Business[]> {
    return BUSINESSES.filter(
      (b) => b.status === "published" && b.city.slug === citySlug,
    ).slice(0, limit);
  }

  async getSimilar(business: Business, limit = 4): Promise<Business[]> {
    return BUSINESSES.filter(
      (b) =>
        b.id !== business.id &&
        b.status === "published" &&
        (b.primaryCategory.id === business.primaryCategory.id ||
          b.city.id === business.city.id),
    )
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);
  }
}

class DemoReviewRepository implements ReviewRepository {
  async listForBusiness(businessId: string, limit = 10): Promise<Review[]> {
    return REVIEWS.filter((r) => r.businessId === businessId).slice(0, limit);
  }
}

function sortBusinesses(items: Business[], sort: SortOption): Business[] {
  const arr = items.slice();
  switch (sort) {
    case "highest_rated":
      return arr.sort((a, b) => b.rating - a.rating);
    case "most_reviewed":
      return arr.sort((a, b) => b.reviewCount - a.reviewCount);
    case "recently_added":
      return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case "name":
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case "recommended":
    default:
      return arr.sort((a, b) => {
        const featScore = Number(b.isFeatured) - Number(a.isFeatured);
        if (featScore !== 0) return featScore;
        return b.rating - a.rating;
      });
  }
}

// -----------------------------------------------------------------------------
// Service registry — swap here in Phase 2 for Supabase-backed implementations.

export const services = {
  businesses: new DemoBusinessRepository() as BusinessRepository,
  categories: new DemoCategoryRepository() as CategoryRepository,
  cities: new DemoCityRepository() as CityRepository,
  reviews: new DemoReviewRepository() as ReviewRepository,
};

export type Services = typeof services;
