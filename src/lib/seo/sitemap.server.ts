import { supabase } from "@/integrations/supabase/client";
import { LOCALES, type Locale } from "@/types/domain";
import { configuredSiteOrigin, safePathSegment, xmlEscape } from "./url";

const SITEMAP_MAX_URLS = 45_000;
const BUSINESS_PAGE_SIZE = 1_000;
const COMBO_CACHE_TTL_MS = 60 * 60 * 1_000;

type SitemapBatch = {
  page: number;
  totalPages: number;
  xml: string;
};

type RouteEntry = {
  path: string;
  lastmod?: string | null;
  changefreq?: string;
  priority?: string;
};

type BusinessRouteRow = {
  slug: string | null;
  updated_at: string | null;
};

type ComboRow = {
  updated_at: string | null;
  city: { slug: string | null } | null;
  district: { slug: string | null } | null;
  primary_category: { slug: string | null } | null;
};

let comboEntriesCache:
  | { expiresAt: number; promise: Promise<RouteEntry[]> }
  | undefined;

function sitemapXml(urls: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.0.9">',
    ...urls,
    "</urlset>",
  ].join("\n");
}

function sitemapIndexXml(indexes: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.0.9">',
    ...indexes,
    "</sitemapindex>",
  ].join("\n");
}

function sitemapIndexEntry(loc: string): string {
  return `  <sitemap>\n    <loc>${xmlEscape(loc)}</loc>\n  </sitemap>`;
}

function normalizeDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function routeUrl(origin: string, locale: Locale, path: string): string {
  const cleanPath = path === "/" ? "" : path;
  return `${origin}/${locale}${cleanPath}`;
}

function xmlUrl(origin: string, locale: Locale, entry: RouteEntry): string {
  const loc = routeUrl(origin, locale, entry.path);
  const lastmod = normalizeDate(entry.lastmod);
  let s = `  <url>\n    <loc>${xmlEscape(loc)}</loc>`;
  if (lastmod) s += `\n    <lastmod>${lastmod}</lastmod>`;
  if (entry.changefreq) s += `\n    <changefreq>${entry.changefreq}</changefreq>`;
  if (entry.priority) s += `\n    <priority>${entry.priority}</priority>`;
  s += "\n  </url>";
  return s;
}

function expandLocales(origin: string, entries: RouteEntry[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const locale of LOCALES) {
      const loc = routeUrl(origin, locale, entry.path);
      if (seen.has(loc)) continue;
      seen.add(loc);
      urls.push(xmlUrl(origin, locale, entry));
    }
  }
  return urls;
}

function pathFromSegments(...segments: string[]): string | null {
  const safe = segments.map(safePathSegment);
  if (safe.some((s) => !s)) return null;
  return `/${safe.join("/")}`;
}

export async function generateStaticPagesSitemap(siteUrl: string): Promise<string> {
  const origin = configuredSiteOrigin(siteUrl);
  return sitemapXml(
    expandLocales(origin, [
      { path: "/", changefreq: "weekly", priority: "1.0" },
    ]),
  );
}

export async function generateCategoriesSitemap(siteUrl: string): Promise<string> {
  const origin = configuredSiteOrigin(siteUrl);
  const { data, error } = await supabase
    .from("categories")
    .select("slug, updated_at")
    .eq("is_active", true);
  if (error || !data) return sitemapXml([]);

  const entries = data.flatMap((row) => {
    const path = row.slug ? pathFromSegments(row.slug) : null;
    return path ? [{ path, lastmod: row.updated_at, changefreq: "weekly", priority: "0.8" }] : [];
  });
  return sitemapXml(expandLocales(origin, entries));
}

export async function generateCitiesSitemap(siteUrl: string): Promise<string> {
  const origin = configuredSiteOrigin(siteUrl);
  const { data, error } = await supabase
    .from("cities")
    .select("slug, updated_at")
    .eq("is_active", true);
  if (error || !data) return sitemapXml([]);

  const entries = data.flatMap((row) => {
    const path = row.slug ? pathFromSegments(row.slug) : null;
    return path ? [{ path, lastmod: row.updated_at, changefreq: "weekly", priority: "0.8" }] : [];
  });
  return sitemapXml(expandLocales(origin, entries));
}

async function loadComboEntries(): Promise<RouteEntry[]> {
  const entries = new Map<string, RouteEntry>();
  let from = 0;
  while (true) {
    const to = from + BUSINESS_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("businesses")
      .select(
        `
          updated_at,
          city:cities!businesses_city_id_fkey(slug),
          district:districts!businesses_district_id_fkey(slug),
          primary_category:categories!businesses_primary_category_id_fkey(slug)
        `,
      )
      .eq("status", "published")
      .range(from, to);
    if (error || !data || data.length === 0) break;

    for (const row of data as unknown as ComboRow[]) {
      const citySlug = row.city?.slug;
      const catSlug = row.primary_category?.slug;
      if (!citySlug || !catSlug) continue;
      const cityCatPath = pathFromSegments(citySlug, catSlug);
      if (cityCatPath) mergeEntry(entries, cityCatPath, row.updated_at, "weekly", "0.7");

      const districtSlug = row.district?.slug;
      if (districtSlug) {
        const districtPath = pathFromSegments(citySlug, districtSlug, catSlug);
        if (districtPath) mergeEntry(entries, districtPath, row.updated_at, "weekly", "0.6");
      }
    }

    if (data.length < BUSINESS_PAGE_SIZE) break;
    from += BUSINESS_PAGE_SIZE;
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function loadComboEntriesCached(): Promise<RouteEntry[]> {
  const now = Date.now();
  if (!comboEntriesCache || comboEntriesCache.expiresAt <= now) {
    const promise = loadComboEntries().catch((error) => {
      comboEntriesCache = undefined;
      throw error;
    });
    comboEntriesCache = {
      expiresAt: now + COMBO_CACHE_TTL_MS,
      promise,
    };
  }
  return comboEntriesCache.promise;
}

function mergeEntry(
  entries: Map<string, RouteEntry>,
  path: string,
  lastmod: string | null,
  changefreq: string,
  priority: string,
) {
  const existing = entries.get(path);
  if (!existing) {
    entries.set(path, { path, lastmod, changefreq, priority });
    return;
  }
  if (lastmod && (!existing.lastmod || lastmod > existing.lastmod)) {
    existing.lastmod = lastmod;
  }
}

export async function generateComboBatch(siteUrl: string, page: number): Promise<SitemapBatch | null> {
  const origin = configuredSiteOrigin(siteUrl);
  const entries = await loadComboEntriesCached();
  return batchEntries(origin, entries, page);
}

export async function generateComboSitemapIndexes(siteUrl: string): Promise<string[]> {
  const origin = configuredSiteOrigin(siteUrl);
  const entries = await loadComboEntriesCached();
  const totalUrls = entries.length * LOCALES.length;
  const totalPages = Math.max(1, Math.ceil(totalUrls / SITEMAP_MAX_URLS));
  return Array.from({ length: totalPages }, (_, i) =>
    sitemapIndexEntry(`${origin}/sitemap-directory-${i + 1}.xml`),
  );
}

export async function generateBusinessesBatch(siteUrl: string, page: number): Promise<SitemapBatch | null> {
  const origin = configuredSiteOrigin(siteUrl);
  const from = (page - 1) * Math.floor(SITEMAP_MAX_URLS / LOCALES.length);
  const pageSize = Math.floor(SITEMAP_MAX_URLS / LOCALES.length);
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("businesses")
    .select("slug, updated_at", { count: "exact" })
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (error || !data || page < 1) return null;

  const totalPages = Math.max(1, Math.ceil(((count ?? 0) * LOCALES.length) / SITEMAP_MAX_URLS));
  if (page > totalPages) return null;

  const entries = (data as BusinessRouteRow[]).flatMap((row) => {
    const slug = row.slug ? safePathSegment(row.slug) : null;
    return slug ? [{ path: `/place/${slug}`, lastmod: row.updated_at, changefreq: "weekly", priority: "0.6" }] : [];
  });

  return { page, totalPages, xml: sitemapXml(expandLocales(origin, entries)) };
}

export async function generateBusinessesSitemapIndexes(siteUrl: string): Promise<string[]> {
  const origin = configuredSiteOrigin(siteUrl);
  const { count, error } = await supabase
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");
  if (error) return [];
  const totalPages = Math.max(1, Math.ceil(((count ?? 0) * LOCALES.length) / SITEMAP_MAX_URLS));
  return Array.from({ length: totalPages }, (_, i) =>
    sitemapIndexEntry(`${origin}/sitemap-businesses-${i + 1}.xml`),
  );
}

function batchEntries(origin: string, entries: RouteEntry[], page: number): SitemapBatch | null {
  const totalUrls = entries.length * LOCALES.length;
  const totalPages = Math.max(1, Math.ceil(totalUrls / SITEMAP_MAX_URLS));
  if (page < 1 || page > totalPages) return null;

  const expanded = expandLocales(origin, entries);
  const start = (page - 1) * SITEMAP_MAX_URLS;
  const urls = expanded.slice(start, start + SITEMAP_MAX_URLS);
  return { page, totalPages, xml: sitemapXml(urls) };
}

export async function generateSitemapIndex(siteUrl: string): Promise<string> {
  const origin = configuredSiteOrigin(siteUrl);
  const entries = [
    sitemapIndexEntry(`${origin}/sitemap-pages.xml`),
    sitemapIndexEntry(`${origin}/sitemap-categories.xml`),
    sitemapIndexEntry(`${origin}/sitemap-cities.xml`),
    ...(await generateComboSitemapIndexes(origin)),
    ...(await generateBusinessesSitemapIndexes(origin)),
  ];
  return sitemapIndexXml(entries);
}

export function generateRobotsTxt(siteUrl: string): string {
  const origin = configuredSiteOrigin(siteUrl);
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /*/_authenticated",
    "Disallow: /*/admin",
    "Disallow: /*/auth",
    "Disallow: /*/account",
    "Disallow: /*/owner",
    "Disallow: /api/",
    "Disallow: /_tanstack/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}
