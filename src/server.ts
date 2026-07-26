import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  generateSitemapIndex,
  generateStaticPagesSitemap,
  generateCategoriesSitemap,
  generateCitiesSitemap,
  generateCatCityBatch,
  generateBusinessesBatch,
  generateRobotsTxt,
} from "./lib/seo/sitemap.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

const STATIC_ASSET_EXTENSIONS = /\.(ico|png|jpg|jpeg|gif|svg|webp|css|js|woff2?|ttf|eot|json|webmanifest)$/i;

async function handleSitemapRoute(url: URL): Promise<Response | null> {
  const siteUrl = url.origin;
  const pathname = url.pathname;

  if (pathname === "/robots.txt") {
    const robots = generateRobotsTxt(siteUrl);
    return new Response(robots, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=86400, s-maxage=3600",
      },
    });
  }

  const headers = {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, max-age=86400, s-maxage=3600",
  };

  try {
    switch (pathname) {
      case "/sitemap.xml": {
        const xml = await generateSitemapIndex(siteUrl);
        return new Response(xml, { headers });
      }
      case "/sitemap-pages.xml": {
        const xml = await generateStaticPagesSitemap(siteUrl);
        return new Response(xml, { headers });
      }
      case "/sitemap-categories.xml": {
        const xml = await generateCategoriesSitemap(siteUrl);
        return new Response(xml, { headers });
      }
      case "/sitemap-cities.xml": {
        const xml = await generateCitiesSitemap(siteUrl);
        return new Response(xml, { headers });
      }
    }

    // Pattern: /sitemap-catcity-{page}.xml
    const catCityMatch = pathname.match(/^\/sitemap-catcity-(\d+)\.xml$/);
    if (catCityMatch) {
      const page = parseInt(catCityMatch[1], 10);
      const result = await generateCatCityBatch(siteUrl, page);
      if (result) return new Response(result.xml, { headers });
      return new Response("Not Found", { status: 404 });
    }

    // Pattern: /sitemap-businesses-{page}.xml
    const bizMatch = pathname.match(/^\/sitemap-businesses-(\d+)\.xml$/);
    if (bizMatch) {
      const page = parseInt(bizMatch[1], 10);
      const result = await generateBusinessesBatch(siteUrl, page);
      if (result) return new Response(result.xml, { headers });
      return new Response("Not Found", { status: 404 });
    }
  } catch (error) {
    console.error("Sitemap generation error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }

  return null;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);

      // Bypass TanStack for static assets and SEO routes
      if (STATIC_ASSET_EXTENSIONS.test(url.pathname)) {
        const handler = await getServerEntry();
        return await handler.fetch(request, env, ctx);
      }

      const sitemapResponse = await handleSitemapRoute(url);
      if (sitemapResponse) return sitemapResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
