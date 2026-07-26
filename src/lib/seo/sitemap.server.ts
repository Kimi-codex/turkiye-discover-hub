import { supabase } from "@/integrations/supabase/client";
import { LOCALES } from "@/types/domain";

const SITEMAP_MAX_URLS = 45000;

function xmlUrl(loc: string, lastmod?: string, changefreq?: string, priority?: string): string {
  let s = `  <url>\n    <loc>${loc}</loc>`;
  if (lastmod) s += `\n    <lastmod>${lastmod}</lastmod>`;
  if (changefreq) s += `\n    <changefreq>${changefreq}</changefreq>`;
  if (priority) s += `\n    <priority>${priority}</priority>`;
  s += "\n  </url>";
  return s;
}

function sitemapXml(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.0.9">\n${urls.join("\n")}\n</urlset>`;
}

function sitemapIndexXml(indexes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.0.9">\n${indexes.join("\n")}\n</sitemapindex>`;
}

function sitemapIndexEntry(loc: string): string {
  return `  <sitemap>\n    <loc>${loc}</loc>\n  </sitemap>`;
}

function localePath(siteUrl: string, locale: string, path: string): string {
  if (path === "/") return `${siteUrl}/${locale}`;
  return `${siteUrl}/${locale}${path}`;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function forEachLocale(fn: (locale: string) => string[]): string[] {
  const results: string[] = [];
  for (const locale of LOCALES) {
    results.push(...fn(locale));
  }
  return results;
}

type SitemapBatch = {
  page: number;
  totalPages: number;
  xml: string;
};

// ── Static Pages ──────────────────────────────────────────
export async function generateStaticPagesSitemap(siteUrl: string): Promise<string> {
  const urls: string[] = [];
  for (const locale of LOCALES) {
    urls.push(xmlUrl(localePath(siteUrl, locale, "/"), todayDate(), "weekly", "1.0"));
    urls.push(xmlUrl(localePath(siteUrl, locale, "/search"), undefined, "never", "0.3"));
  }
  return sitemapXml(urls);
}

// ── Categories ────────────────────────────────────────────
export async function generateCategoriesSitemap(siteUrl: string): Promise<string> {
  const { data: categories } = await supabase
    .from("categories")
    .select("slug, updated_at")
    .eq("is_active", true);
  if (!categories) return sitemapXml([]);

  const urls = forEachLocale((locale) =>
    categories.map((cat) =>
      xmlUrl(
        localePath(siteUrl, locale, `/${cat.slug}`),
        cat.updated_at?.slice(0, 10) ?? undefined,
        "weekly",
        "0.8",
      ),
    ),
  );
  return sitemapXml(urls);
}

// ── Cities ────────────────────────────────────────────────
export async function generateCitiesSitemap(siteUrl: string): Promise<string> {
  const { data: cities } = await supabase
    .from("cities")
    .select("slug, updated_at")
    .eq("is_active", true);
  if (!cities) return sitemapXml([]);

  const urls = forEachLocale((locale) =>
    cities.map((city) =>
      xmlUrl(
        localePath(siteUrl, locale, `/${city.slug}`),
        city.updated_at?.slice(0, 10) ?? undefined,
        "weekly",
        "0.8",
      ),
    ),
  );
  return sitemapXml(urls);
}

// ── Category-City pages ───────────────────────────────────
async function loadCatCityPairs(): Promise<{ citySlug: string; catSlug: string }[]> {
  const [{ data: cities }, { data: categories }] = await Promise.all([
    supabase.from("cities").select("slug").eq("is_active", true),
    supabase.from("categories").select("slug").eq("is_active", true),
  ]);
  if (!cities || !categories) return [];
  const pairs: { citySlug: string; catSlug: string }[] = [];
  for (const city of cities) {
    for (const cat of categories) {
      pairs.push({ citySlug: city.slug, catSlug: cat.slug });
    }
  }
  return pairs;
}

export async function generateCatCityBatch(siteUrl: string, page: number): Promise<SitemapBatch | null> {
  const pairs = await loadCatCityPairs();
  if (pairs.length === 0) return null;

  const totalPairs = pairs.length * LOCALES.length;
  const totalPages = Math.max(1, Math.ceil(totalPairs / SITEMAP_MAX_URLS));
  if (page < 1 || page > totalPages) return null;

  const startIdx = (page - 1) * SITEMAP_MAX_URLS;
  const endIdx = startIdx + SITEMAP_MAX_URLS;
  const urls: string[] = [];

  let globalIdx = 0;
  for (const locale of LOCALES) {
    for (const pair of pairs) {
      if (globalIdx < startIdx) { globalIdx++; continue; }
      if (globalIdx >= endIdx) break;
      urls.push(xmlUrl(localePath(siteUrl, locale, `/${pair.citySlug}/${pair.catSlug}`), undefined, "weekly", "0.7"));
      globalIdx++;
    }
    if (globalIdx >= endIdx) break;
  }

  return { page, totalPages, xml: sitemapXml(urls) };
}

export async function generateCatCitySitemapIndexes(siteUrl: string): Promise<string[]> {
  const pairs = await loadCatCityPairs();
  if (pairs.length === 0) return [];

  const totalPairs = pairs.length * LOCALES.length;
  const totalPages = Math.max(1, Math.ceil(totalPairs / SITEMAP_MAX_URLS));
  const indexes: string[] = [];
  for (let i = 1; i <= totalPages; i++) {
    indexes.push(sitemapIndexEntry(`${siteUrl}/sitemap-catcity-${i}.xml`));
  }
  return indexes;
}

// ── Business detail pages ─────────────────────────────────
export async function generateBusinessesBatch(siteUrl: string, page: number): Promise<SitemapBatch | null> {
  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("slug, updated_at")
    .eq("status", "published")
    .order("updated_at", { ascending: false });
  if (error || !businesses) return null;

  const totalBiz = businesses.length * LOCALES.length;
  const totalPages = Math.max(1, Math.ceil(totalBiz / SITEMAP_MAX_URLS));
  if (page < 1 || page > totalPages) return null;

  const startIdx = (page - 1) * SITEMAP_MAX_URLS;
  const endIdx = startIdx + SITEMAP_MAX_URLS;
  const urls: string[] = [];

  let globalIdx = 0;
  for (const locale of LOCALES) {
    for (const biz of businesses) {
      if (globalIdx < startIdx) { globalIdx++; continue; }
      if (globalIdx >= endIdx) break;
      urls.push(xmlUrl(
        localePath(siteUrl, locale, `/place/${biz.slug}`),
        biz.updated_at?.slice(0, 10) ?? undefined,
        "weekly",
        "0.6",
      ));
      globalIdx++;
    }
    if (globalIdx >= endIdx) break;
  }

  return { page, totalPages, xml: sitemapXml(urls) };
}

export async function generateBusinessesSitemapIndexes(siteUrl: string): Promise<string[]> {
  const { data: businesses } = await supabase
    .from("businesses")
    .select("slug")
    .eq("status", "published");
  if (!businesses) return [];

  const totalBiz = businesses.length * LOCALES.length;
  const totalPages = Math.max(1, Math.ceil(totalBiz / SITEMAP_MAX_URLS));
  const indexes: string[] = [];
  for (let i = 1; i <= totalPages; i++) {
    indexes.push(sitemapIndexEntry(`${siteUrl}/sitemap-businesses-${i}.xml`));
  }
  return indexes;
}

// ── Sitemap Index ─────────────────────────────────────────
export async function generateSitemapIndex(siteUrl: string): Promise<string> {
  const entries = [
    sitemapIndexEntry(`${siteUrl}/sitemap-pages.xml`),
    sitemapIndexEntry(`${siteUrl}/sitemap-categories.xml`),
    sitemapIndexEntry(`${siteUrl}/sitemap-cities.xml`),
    ...(await generateCatCitySitemapIndexes(siteUrl)),
    ...(await generateBusinessesSitemapIndexes(siteUrl)),
  ];
  return sitemapIndexXml(entries);
}

// ── Robots.txt ────────────────────────────────────────────
export function generateRobotsTxt(siteUrl: string): string {
  return `User-agent: *
Allow: /
Allow: /ar/
Allow: /en/
Allow: /tr/
Allow: /fr/
Allow: /ru/
Disallow: /admin
Disallow: /auth
Disallow: /account
Disallow: /owner
Disallow: /api/
Disallow: /dashboard
Disallow: /_tanstack/
Disallow: /assets/

Sitemap: ${siteUrl}/sitemap.xml
`;
}
