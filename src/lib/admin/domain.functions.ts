/**
 * Admin domain server functions: businesses, categories, cities, mappings,
 * reviews, reports, ownership claims, audit logs, and site settings.
 *
 * Every export attaches `requireAdmin` middleware, so admin authorization
 * is verified server-side on every call — the route loader gate is defense
 * in depth, not a substitute.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./require-admin.middleware";

type AppRole = "admin" | "moderator" | "business_owner" | "user";
// Admin handlers use dynamic queries across many tables; the generated
// Supabase types over-constrain the shape. Alias to `any` for these handlers.
// Safety comes from RLS + `requireAdmin` middleware, not from client typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminSb = any;

async function audit(
  supabase: AdminSb,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  metadata: unknown,
) {
  await supabase.rpc("record_audit", {
    _action: action,
    _entity_type: entityType,
    _entity_id: entityId,
    _before: before,
    _after: after,
    _metadata: metadata ?? {},
  });
}

// ─────────────────────────── BUSINESSES ────────────────────────────

export const listBusinessesAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      page?: number;
      perPage?: number;
      search?: string;
      status?: string;
      cityId?: string;
      categoryId?: string;
      featured?: boolean;
      verified?: boolean;
      source?: string;
      sort?: "recent" | "name" | "rating";
    } | undefined) => ({
      page: Math.max(1, Math.floor(i?.page ?? 1)),
      perPage: Math.min(100, Math.max(1, Math.floor(i?.perPage ?? 25))),
      search: (i?.search ?? "").trim(),
      status: i?.status ?? null,
      cityId: i?.cityId ?? null,
      categoryId: i?.categoryId ?? null,
      featured: i?.featured ?? null,
      verified: i?.verified ?? null,
      source: i?.source ?? null,
      sort: i?.sort ?? "recent",
    }),
  )
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    let q = supabase
      .from("businesses")
      .select(
        "id, name, slug, place_id, status, source, is_featured, is_verified, rating, review_count, city_id, primary_category_id, created_at, updated_at",
        { count: "exact" },
      );
    if (data.status) q = q.eq("status", data.status);
    if (data.cityId) q = q.eq("city_id", data.cityId);
    if (data.categoryId) q = q.eq("primary_category_id", data.categoryId);
    if (data.featured !== null) q = q.eq("is_featured", data.featured);
    if (data.verified !== null) q = q.eq("is_verified", data.verified);
    if (data.source) q = q.eq("source", data.source);
    if (data.search) {
      const s = data.search.replace(/,/g, " ").trim();
      q = q.or(`name.ilike.%${s}%,slug.ilike.%${s}%,place_id.ilike.%${s}%`);
    }
    if (data.sort === "name") q = q.order("name", { ascending: true });
    else if (data.sort === "rating")
      q = q.order("rating", { ascending: false, nullsFirst: false });
    else q = q.order("created_at", { ascending: false });
    const from = (data.page - 1) * data.perPage;
    const to = from + data.perPage - 1;
    q = q.range(from, to);
    const { data: rows, count, error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [], total: count ?? 0, page: data.page, perPage: data.perPage };
  });

export const getBusinessAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => ({ id: String(i?.id ?? "") }))
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    const [
      { data: biz, error },
      { data: images },
      { data: hours },
      { data: services },
      { data: attrs },
      { data: translations },
      { data: catLinks },
    ] = await Promise.all([
      supabase.from("businesses").select("*").eq("id", data.id).maybeSingle(),
      supabase
        .from("business_images")
        .select("*")
        .eq("business_id", data.id)
        .order("sort_order"),
      supabase
        .from("business_opening_hours")
        .select("*")
        .eq("business_id", data.id)
        .order("day_of_week"),
      supabase.from("business_services").select("*").eq("business_id", data.id),
      supabase.from("business_attributes").select("*").eq("business_id", data.id),
      supabase.from("business_translations").select("*").eq("business_id", data.id),
      supabase
        .from("business_category_links")
        .select("category_id, is_primary")
        .eq("business_id", data.id),
    ]);
    if (error) throw new Response(error.message, { status: 500 });
    if (!biz) throw new Response("Not found", { status: 404 });
    return {
      business: biz,
      images: images ?? [],
      hours: hours ?? [],
      services: services ?? [],
      attributes: attrs ?? [],
      translations: translations ?? [],
      categoryLinks: catLinks ?? [],
    };
  });

const BUSINESS_EDITABLE_FIELDS = [
  "name",
  "slug",
  "description",
  "formatted_address",
  "city_id",
  "district_id",
  "latitude",
  "longitude",
  "phone",
  "website",
  "primary_category_id",
  "email",
  "price_level",
] as const;

export const updateBusinessAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id: string;
      patch: Partial<Record<(typeof BUSINESS_EDITABLE_FIELDS)[number], unknown>>;
    }) => {
      if (!i?.id || typeof i.id !== "string") {
        throw new Response("Invalid id", { status: 400 });
      }
      const patch: Record<string, unknown> = {};
      for (const k of BUSINESS_EDITABLE_FIELDS) {
        if (i.patch && k in i.patch) patch[k] = i.patch[k];
      }
      return { id: i.id, patch };
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    const { data: before } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Response("Not found", { status: 404 });
    const nowIso = new Date().toISOString();
    // Update field_sources so precedence tracks admin edits
    const fieldSources = (before.field_sources as Record<string, unknown> | null) ?? {};
    for (const k of Object.keys(data.patch)) {
      fieldSources[k] = { source: "admin", updated_at: nowIso };
    }
    const { data: after, error } = await supabase
      .from("businesses")
      .update({ ...data.patch, field_sources: fieldSources })
      .eq("id", data.id)
      .select()
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 400 });
    await audit(supabase, "business.update", "business", data.id, before, after, {
      fields: Object.keys(data.patch),
    });
    return { ok: true };
  });

export const setBusinessStatusAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id: string;
      status: "draft" | "pending_review" | "published" | "hidden" | "rejected";
    }) => {
      if (!i?.id) throw new Response("Invalid id", { status: 400 });
      const ok = ["draft", "pending_review", "published", "hidden", "rejected"].includes(i.status);
      if (!ok) throw new Response("Invalid status", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    const { data: before } = await supabase
      .from("businesses")
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Response("Not found", { status: 404 });
    const { error } = await supabase
      .from("businesses")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await audit(
      supabase,
      "business.status_change",
      "business",
      data.id,
      { status: before.status },
      { status: data.status },
      {},
    );
    return { ok: true };
  });

export const setBusinessFlagAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: { id: string; flag: "is_featured" | "is_verified"; value: boolean }) => {
      if (!i?.id) throw new Response("Invalid id", { status: 400 });
      if (i.flag !== "is_featured" && i.flag !== "is_verified")
        throw new Response("Invalid flag", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    const { error } = await supabase
      .from("businesses")
      .update({ [data.flag]: data.value })
      .eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await audit(supabase, "business.flag", "business", data.id, null, {
      [data.flag]: data.value,
    }, {});
    return { ok: true };
  });

export const deleteBusinessAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string; confirmSlug: string }) => {
    if (!i?.id || !i?.confirmSlug) throw new Response("Invalid", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    const { data: before } = await supabase
      .from("businesses")
      .select("id, slug")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Response("Not found", { status: 404 });
    if (before.slug !== data.confirmSlug)
      throw new Response("Slug confirmation mismatch", { status: 400 });
    const { error } = await supabase.from("businesses").delete().eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await audit(supabase, "business.delete", "business", data.id, before, null, {});
    return { ok: true };
  });

// ─────────────────────────── CATEGORIES ────────────────────────────

export const listCategoriesAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as AdminSb)
      .from("categories")
      .select("*, category_translations(*)")
      .order("sort_order");
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: data ?? [] };
  });

export const upsertCategoryAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id?: string;
      parent_id: string | null;
      slug: string;
      icon: string | null;
      image_url: string | null;
      category_type: string | null;
      is_active: boolean;
      sort_order: number;
      translations: Array<{ language: string; name: string; description?: string | null }>;
    }) => {
      if (!i?.slug || typeof i.slug !== "string")
        throw new Response("Invalid slug", { status: 400 });
      if (!Array.isArray(i.translations)) throw new Response("Invalid translations", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    // Cycle prevention: parent must not be self or descendant
    if (data.id && data.parent_id) {
      if (data.parent_id === data.id) throw new Response("Cannot be own parent", { status: 400 });
      // Walk up: if we ever meet data.id it's a cycle
      let cur: string | null = data.parent_id;
      const seen = new Set<string>();
      while (cur) {
        if (seen.has(cur)) break;
        seen.add(cur);
        if (cur === data.id) throw new Response("Cycle in parent chain", { status: 400 });
        const { data: p } = (await supabase.from("categories").select("parent_id").eq("id", cur).maybeSingle()) as { data: { parent_id: string | null } | null };
        cur = p?.parent_id ?? null;
      }
    }
    let categoryId = data.id;
    if (categoryId) {
      const { error } = await supabase
        .from("categories")
        .update({
          parent_id: data.parent_id,
          slug: data.slug,
          icon: data.icon,
          image_url: data.image_url,
          category_type: data.category_type,
          is_active: data.is_active,
          sort_order: data.sort_order,
        })
        .eq("id", categoryId);
      if (error) throw new Response(error.message, { status: 400 });
    } else {
      const { data: ins, error } = await supabase
        .from("categories")
        .insert({
          parent_id: data.parent_id,
          slug: data.slug,
          icon: data.icon,
          image_url: data.image_url,
          category_type: data.category_type,
          is_active: data.is_active,
          sort_order: data.sort_order,
        })
        .select("id")
        .single();
      if (error) throw new Response(error.message, { status: 400 });
      categoryId = ins.id;
    }
    // Replace translations
    await supabase.from("category_translations").delete().eq("category_id", categoryId);
    if (data.translations.length > 0) {
      const rows = data.translations
        .filter((t) => ["ar", "en", "tr"].includes(t.language) && t.name)
        .map((t) => ({
          category_id: categoryId,
          language_code: t.language,
          name: t.name,
          description: t.description ?? null,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("category_translations").insert(rows);
        if (error) throw new Response(error.message, { status: 400 });
      }
    }
    await audit(supabase, "category.upsert", "category", categoryId!, null, data, {});
    return { ok: true, id: categoryId };
  });

export const deleteCategoryAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Invalid id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as AdminSb).from("categories").delete().eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await audit((context.supabase as AdminSb), "category.delete", "category", data.id, null, null, {});
    return { ok: true };
  });

// ─────────────────────────── CATEGORY MAPPINGS ─────────────────────

export const listCategoryMappingsAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: { status?: "pending" | "approved" | "ignored"; batchId?: string } | undefined) => ({
      status: i?.status ?? "pending",
      batchId: typeof i?.batchId === "string" && i.batchId.length > 0 ? i.batchId : null,
    }),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as AdminSb;
    let labels: string[] | null = null;
    let statusCounts: Record<string, number> | null = null;
    if (data.batchId) {
      const { data: items, error: itemError } = await supabase
        .from("import_batch_items")
        .select("raw_payload")
        .eq("import_batch_id", data.batchId)
        .limit(5000);
      if (itemError) throw new Response(itemError.message, { status: 500 });
      const seen = new Set<string>();
      (items ?? []).forEach((it: Record<string, unknown>) => {
        const rawPayload = (it.raw_payload as Record<string, unknown> | null) ?? {};
        const normalized = rawPayload.normalized as {
          categoriesSource?: unknown;
          primaryCategorySource?: unknown;
        } | null;
        if (!normalized) return;
        if (Array.isArray(normalized.categoriesSource)) {
          normalized.categoriesSource.forEach((label) => {
            if (typeof label === "string" && label.trim()) seen.add(label);
          });
        }
        if (typeof normalized.primaryCategorySource === "string" && normalized.primaryCategorySource.trim()) {
          seen.add(normalized.primaryCategorySource);
        }
      });
      labels = Array.from(seen).sort();
      if (labels.length === 0) return { rows: [], batchScoped: true, labelCount: 0, statusCounts: {} };

      const normalizedLabels = labels.map((label) => label.toLowerCase().trim()).filter(Boolean);
      const { data: existingMappings, error: existingError } = await supabase
        .from("category_mappings")
        .select("normalized_source_category")
        .eq("source_provider", "google")
        .in("normalized_source_category", normalizedLabels);
      if (existingError) throw new Response(existingError.message, { status: 500 });

      const existingSet = new Set(
        (existingMappings ?? []).map((row: { normalized_source_category: string }) => row.normalized_source_category),
      );
      const missingRows = labels
        .map((label) => ({ label, normalized: label.toLowerCase().trim() }))
        .filter(({ normalized }) => normalized && !existingSet.has(normalized))
        .map(({ label, normalized }) => ({
          source_provider: "google",
          source_category: label,
          normalized_source_category: normalized,
          mapping_status: "pending",
          usage_count: 1,
        }));

      if (missingRows.length > 0) {
        const { error: insertError } = await supabase
          .from("category_mappings")
          .upsert(missingRows, {
            onConflict: "source_provider,normalized_source_category",
            ignoreDuplicates: true,
          });
        if (insertError) throw new Response(insertError.message, { status: 500 });
      }

      const { data: allBatchMappings, error: countsError } = await supabase
        .from("category_mappings")
        .select("mapping_status")
        .eq("source_provider", "google")
        .in("normalized_source_category", normalizedLabels);
      if (countsError) throw new Response(countsError.message, { status: 500 });
      statusCounts = { pending: 0, approved: 0, ignored: 0, missing: 0 };
      (allBatchMappings ?? []).forEach((row: { mapping_status: string }) => {
        statusCounts![row.mapping_status] = (statusCounts![row.mapping_status] ?? 0) + 1;
      });
      statusCounts.missing = Math.max(0, labels.length - (allBatchMappings?.length ?? 0));
    }

    let query = supabase
      .from("category_mappings")
      .select("*")
      .eq("mapping_status", data.status)
      .order("usage_count", { ascending: false });
    if (labels) {
      query = query
        .eq("source_provider", "google")
        .in(
          "normalized_source_category",
          labels.map((label) => label.toLowerCase().trim()).filter(Boolean),
        );
    }
    const { data: rows, error } = await query.limit(500);
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [], batchScoped: !!data.batchId, labelCount: labels?.length ?? null, statusCounts };
  });

export const setCategoryMappingAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      ids: string[];
      status: "approved" | "ignored" | "pending";
      categoryId?: string | null;
    }) => {
      if (!Array.isArray(i?.ids) || i.ids.length === 0)
        throw new Response("No mappings selected", { status: 400 });
      if (!["approved", "ignored", "pending"].includes(i.status))
        throw new Response("Invalid status", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { mapping_status: data.status };
    if (data.status === "approved") {
      if (!data.categoryId) throw new Response("categoryId required to approve", { status: 400 });
      patch.category_id = data.categoryId;
    }
    const { error } = await (context.supabase as AdminSb)
      .from("category_mappings")
      .update(patch)
      .in("id", data.ids);
    if (error) throw new Response(error.message, { status: 400 });
    for (const id of data.ids) {
      await audit((context.supabase as AdminSb), "category_mapping.set", "category_mapping", id, null, patch, {});
    }
    return { ok: true };
  });

// ─────────────────────────── CITIES / DISTRICTS ────────────────────

export const listCitiesAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as AdminSb)
      .from("cities")
      .select("*, city_translations(*)")
      .order("sort_order");
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: data ?? [] };
  });

export const upsertCityAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id?: string;
      country_id: string;
      slug: string;
      latitude: number | null;
      longitude: number | null;
      image_url: string | null;
      is_featured: boolean;
      is_active: boolean;
      sort_order: number;
      translations: Array<{ language: string; name: string; description?: string | null }>;
    }) => {
      if (!i?.slug || !i?.country_id) throw new Response("Missing slug/country", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    // Prevent duplicate slug (excluding self)
    const dupQ = supabase.from("cities").select("id").eq("slug", data.slug).limit(1);
    const { data: dup } = await dupQ;
    if (dup && dup.length > 0 && dup[0].id !== data.id) {
      throw new Response("City slug already exists", { status: 409 });
    }
    let cityId = data.id;
    if (cityId) {
      const { error } = await supabase
        .from("cities")
        .update({
          country_id: data.country_id,
          slug: data.slug,
          latitude: data.latitude,
          longitude: data.longitude,
          image_url: data.image_url,
          is_featured: data.is_featured,
          is_active: data.is_active,
          sort_order: data.sort_order,
        })
        .eq("id", cityId);
      if (error) throw new Response(error.message, { status: 400 });
    } else {
      const { data: ins, error } = await supabase
        .from("cities")
        .insert({
          country_id: data.country_id,
          slug: data.slug,
          latitude: data.latitude,
          longitude: data.longitude,
          image_url: data.image_url,
          is_featured: data.is_featured,
          is_active: data.is_active,
          sort_order: data.sort_order,
        })
        .select("id")
        .single();
      if (error) throw new Response(error.message, { status: 400 });
      cityId = ins.id;
    }
    await supabase.from("city_translations").delete().eq("city_id", cityId);
    const rows = data.translations
      .filter((t) => ["ar", "en", "tr"].includes(t.language) && t.name)
      .map((t) => ({
        city_id: cityId,
        language_code: t.language,
        name: t.name,
        description: t.description ?? null,
      }));
    if (rows.length > 0) {
      const { error } = await supabase.from("city_translations").insert(rows);
      if (error) throw new Response(error.message, { status: 400 });
    }
    await audit(supabase, "city.upsert", "city", cityId!, null, data, {});
    return { ok: true, id: cityId };
  });

export const listDistrictsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { cityId: string }) => {
    if (!i?.cityId) throw new Response("Missing cityId", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as AdminSb)
      .from("districts")
      .select("*, district_translations(*)")
      .eq("city_id", data.cityId)
      .order("slug");
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [] };
  });

export const upsertDistrictAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id?: string;
      city_id: string;
      slug: string;
      latitude: number | null;
      longitude: number | null;
      is_active: boolean;
      translations: Array<{ language: string; name: string }>;
    }) => {
      if (!i?.slug || !i?.city_id) throw new Response("Missing", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = (context.supabase as AdminSb) as AdminSb;
    const { data: dup } = await supabase
      .from("districts")
      .select("id")
      .eq("city_id", data.city_id)
      .eq("slug", data.slug)
      .limit(1);
    if (dup && dup.length > 0 && dup[0].id !== data.id)
      throw new Response("District slug already exists in this city", { status: 409 });
    let id = data.id;
    if (id) {
      const { error } = await supabase
        .from("districts")
        .update({
          slug: data.slug,
          latitude: data.latitude,
          longitude: data.longitude,
          is_active: data.is_active,
        })
        .eq("id", id);
      if (error) throw new Response(error.message, { status: 400 });
    } else {
      const { data: ins, error } = await supabase
        .from("districts")
        .insert({
          city_id: data.city_id,
          slug: data.slug,
          latitude: data.latitude,
          longitude: data.longitude,
          is_active: data.is_active,
        })
        .select("id")
        .single();
      if (error) throw new Response(error.message, { status: 400 });
      id = ins.id;
    }
    await supabase.from("district_translations").delete().eq("district_id", id);
    const rows = data.translations
      .filter((t) => ["ar", "en", "tr"].includes(t.language) && t.name)
      .map((t) => ({ district_id: id, language_code: t.language, name: t.name }));
    if (rows.length > 0) {
      const { error } = await supabase.from("district_translations").insert(rows);
      if (error) throw new Response(error.message, { status: 400 });
    }
    await audit(supabase, "district.upsert", "district", id!, null, data, {});
    return { ok: true, id };
  });

// ─────────────────────────── REVIEWS ───────────────────────────────

export const listReviewsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      page?: number;
      status?: string;
      source?: string;
      rating?: number;
      businessId?: string;
    } | undefined) => ({
      page: Math.max(1, Math.floor(i?.page ?? 1)),
      status: i?.status ?? null,
      source: i?.source ?? null,
      rating: i?.rating ?? null,
      businessId: i?.businessId ?? null,
    }),
  )
  .handler(async ({ data, context }) => {
    const perPage = 50;
    let q = (context.supabase as AdminSb)
      .from("reviews")
      .select("*, businesses(name, slug)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((data.page - 1) * perPage, data.page * perPage - 1);
    if (data.status) q = q.eq("status", data.status);
    if (data.source) q = q.eq("source", data.source);
    if (data.rating) q = q.eq("rating", data.rating);
    if (data.businessId) q = q.eq("business_id", data.businessId);
    const { data: rows, count, error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [], total: count ?? 0, page: data.page, perPage };
  });

export const setReviewStatusAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id: string;
      status: "pending" | "published" | "hidden" | "rejected";
      adminNotes?: string;
    }) => {
      if (!i?.id) throw new Response("Invalid id", { status: 400 });
      if (!["pending", "published", "hidden", "rejected"].includes(i.status))
        throw new Response("Invalid status", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: before } = await (context.supabase as AdminSb)
      .from("reviews")
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Response("Not found", { status: 404 });
    const { error } = await (context.supabase as AdminSb)
      .from("reviews")
      .update({ status: data.status, admin_notes: data.adminNotes ?? null })
      .eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await audit(
      (context.supabase as AdminSb),
      "review.status_change",
      "review",
      data.id,
      { status: before.status },
      { status: data.status },
      { notes: !!data.adminNotes },
    );
    return { ok: true };
  });

// ─────────────────────────── REPORTS ───────────────────────────────

export const listReportsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { status?: string } | undefined) => ({ status: i?.status ?? null }))
  .handler(async ({ data, context }) => {
    let q = (context.supabase as AdminSb).from("reports").select("*").order("created_at", { ascending: false }).limit(200);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [] };
  });

export const setReportStatusAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: { id: string; status: "new" | "under_review" | "resolved" | "dismissed"; internalNotes?: string }) => {
      if (!i?.id) throw new Response("Invalid id", { status: 400 });
      if (!["new", "under_review", "resolved", "dismissed"].includes(i.status))
        throw new Response("Invalid status", { status: 400 });
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: before } = await (context.supabase as AdminSb)
      .from("reports")
      .select("id, status, internal_notes")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Response("Not found", { status: 404 });
    const patch: Record<string, unknown> = { status: data.status };
    if (typeof data.internalNotes === "string") patch.internal_notes = data.internalNotes;
    const { error } = await (context.supabase as AdminSb).from("reports").update(patch).eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await audit(
      (context.supabase as AdminSb),
      "report.status_change",
      "report",
      data.id,
      before,
      patch,
      {},
    );
    return { ok: true };
  });

// ─────────────────────────── OWNERSHIP CLAIMS ──────────────────────

export const listOwnershipClaimsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { status?: string } | undefined) => ({ status: i?.status ?? "pending" }))
  .handler(async ({ data, context }) => {
    let q = (context.supabase as AdminSb)
      .from("ownership_claims")
      .select("*, businesses(name, slug)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [] };
  });

export const approveOwnershipClaimAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => {
    if (!i?.id) throw new Response("Invalid id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    // Atomic RPC handles ownership assignment, role grant, audit.
    const { data: res, error } = await (context.supabase as AdminSb).rpc("approve_ownership_claim", {
      _claim_id: data.id,
    });
    if (error) throw new Response(error.message, { status: 400 });
    return res;
  });

export const rejectOwnershipClaimAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string; reason?: string }) => {
    if (!i?.id) throw new Response("Invalid id", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const { data: before } = await (context.supabase as AdminSb)
      .from("ownership_claims")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Response("Not found", { status: 404 });
    if (before.status !== "pending")
      throw new Response("Claim is not pending", { status: 400 });
    const { error } = await (context.supabase as AdminSb)
      .from("ownership_claims")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        admin_notes: data.reason ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Response(error.message, { status: 400 });
    await audit((context.supabase as AdminSb), "ownership_claim.reject", "ownership_claim", data.id, before, {
      status: "rejected",
      reason: data.reason ?? null,
    }, {});
    return { ok: true };
  });

// ─────────────────────────── AUDIT LOGS ────────────────────────────

// Business onboarding submissions

const ONBOARDING_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "additional_documents_required",
  "approved",
  "rejected",
  "withdrawn",
  "all",
] as const;

const ONBOARDING_REVIEW_DECISIONS = [
  "mark_under_review",
  "changes_requested",
  "additional_documents_required",
  "reject",
  "approve_existing",
] as const;

type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
type OnboardingReviewDecision = (typeof ONBOARDING_REVIEW_DECISIONS)[number];

function requireUuid(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Response(`Invalid ${label}`, { status: 400 });
  }
  return value;
}

export const listBusinessOnboardingAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { status?: OnboardingStatus } | undefined) => {
    const status = i?.status ?? "submitted";
    if (!ONBOARDING_STATUSES.includes(status)) throw new Response("Invalid status", { status: 400 });
    return { status };
  })
  .handler(async ({ data, context }) => {
    let q = (context.supabase as AdminSb)
      .from("business_onboarding_submissions")
      .select(
        "id, applicant_id, submission_type, target_business_id, status, version, locale_draft, business_name_localized, applicant_full_name, applicant_phone, applicant_role, applicant_business_email, commercial_registration_number, commercial_registration_legal_name, commercial_registration_country, submitted_at, reviewed_at, reviewed_by, admin_decision, applicant_message_key, approved_business_id, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [] };
  });

export const getBusinessOnboardingAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => ({ id: requireUuid(i?.id, "id") }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as AdminSb;
    const { data: row, error } = await supabase
      .from("business_onboarding_submissions")
      .select("*, documents:business_onboarding_documents(*), images:business_onboarding_images(*), events:business_onboarding_events(*)")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Response("Submission not found", { status: 404 });

    let targetBusiness = null;
    if (row.target_business_id) {
      const { data: business } = await supabase
        .from("businesses")
        .select("id, name, slug, status, owner_id, is_verified, formatted_address, phone, email, website")
        .eq("id", row.target_business_id)
        .maybeSingle();
      targetBusiness = business ?? null;
    }

    return { row, targetBusiness };
  });

export const getBusinessOnboardingAssetUrlAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { kind: "document" | "image"; id: string }) => {
    const kind = i?.kind;
    if (kind !== "document" && kind !== "image") throw new Response("Invalid asset kind", { status: 400 });
    return { kind, id: requireUuid(i?.id, "id") };
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as AdminSb;
    const table = data.kind === "document" ? "business_onboarding_documents" : "business_onboarding_images";
    const { data: asset, error } = await supabase
      .from(table)
      .select("id, storage_bucket, storage_path, status")
      .eq("id", data.id)
      .single();
    if (error || !asset) throw new Response("Asset not found", { status: 404 });
    if (asset.status === "removed") throw new Response("Asset has been removed", { status: 410 });

    const expectedBucket = data.kind === "document" ? "business-verification-documents" : "business-onboarding-images";
    if (asset.storage_bucket !== expectedBucket || typeof asset.storage_path !== "string" || !asset.storage_path) {
      throw new Response("Invalid asset storage metadata", { status: 400 });
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(expectedBucket)
      .createSignedUrl(asset.storage_path, 300);
    if (signError || !signed?.signedUrl) throw new Response("Could not create signed URL", { status: 500 });
    return { url: signed.signedUrl };
  });

export const reviewBusinessOnboardingAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id: string;
      decision: OnboardingReviewDecision;
      applicantMessageKey?: string | null;
      applicantMessageParams?: Record<string, unknown> | null;
      privateNotes?: string | null;
    }) => {
      const decision = i?.decision;
      if (!ONBOARDING_REVIEW_DECISIONS.includes(decision)) {
        throw new Response("Invalid decision", { status: 400 });
      }
      return {
        id: requireUuid(i?.id, "id"),
        decision,
        applicantMessageKey:
          typeof i?.applicantMessageKey === "string" && i.applicantMessageKey.trim()
            ? i.applicantMessageKey.trim()
            : null,
        applicantMessageParams: i?.applicantMessageParams ?? {},
        privateNotes: typeof i?.privateNotes === "string" && i.privateNotes.trim() ? i.privateNotes.trim() : null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as AdminSb;
    const { data: before, error: beforeError } = await supabase
      .from("business_onboarding_submissions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (beforeError || !before) throw new Response("Submission not found", { status: 404 });
    if (!["submitted", "under_review"].includes(before.status)) {
      throw new Response("Submission is not reviewable", { status: 400 });
    }

    const now = new Date().toISOString();
    const messageKey =
      data.applicantMessageKey ??
      (data.decision === "reject"
        ? "onboarding.event.rejected"
        : data.decision === "changes_requested"
          ? "onboarding.event.changes_requested"
          : data.decision === "additional_documents_required"
            ? "onboarding.event.additional_documents_required"
            : data.decision === "approve_existing"
              ? "onboarding.event.approved"
              : "onboarding.event.under_review");

    const patch: Record<string, unknown> = {
      reviewed_at: now,
      reviewed_by: context.userId,
      admin_notes_private: data.privateNotes,
      applicant_message_key: messageKey,
      applicant_message_params: data.applicantMessageParams,
    };

    if (data.decision === "approve_existing") {
      const { data: row, error } = await supabase.rpc("approve_existing_business_onboarding_submission", {
        _submission_id: data.id,
        _applicant_message_key: messageKey,
        _applicant_message_params: data.applicantMessageParams,
        _private_notes: data.privateNotes,
      });
      if (error) throw new Response(error.message, { status: 400 });
      return { ok: true, row };
    }

    if (data.decision === "mark_under_review") {
      patch.status = "under_review";
      patch.admin_decision = null;
    } else if (data.decision === "changes_requested") {
      patch.status = "changes_requested";
      patch.admin_decision = "changes_requested";
    } else if (data.decision === "additional_documents_required") {
      patch.status = "additional_documents_required";
      patch.admin_decision = "additional_documents_required";
    } else if (data.decision === "reject") {
      patch.status = "rejected";
      patch.admin_decision = "reject";
    }

    const { data: after, error: updateError } = await supabase
      .from("business_onboarding_submissions")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (updateError) throw new Response(updateError.message, { status: 400 });

    await supabase.from("business_onboarding_events").insert({
      submission_id: data.id,
      actor_id: context.userId,
      event_type: data.decision,
      visibility: data.decision === "mark_under_review" ? "internal" : "applicant",
      message_key: messageKey,
      message_params: data.applicantMessageParams,
      metadata: { private_notes: Boolean(data.privateNotes) },
    });

    if (data.decision !== "mark_under_review") {
      await supabase.from("user_notifications").insert({
        user_id: before.applicant_id,
        kind: "business_onboarding",
        title_key: "onboarding.notification.title",
        message_key: messageKey,
        message_params: data.applicantMessageParams,
        related_business_id: after.approved_business_id ?? before.target_business_id ?? null,
        related_submission_id: data.id,
      });
    }

    await audit(supabase, `business_onboarding.${data.decision}`, "business_onboarding_submission", data.id, before, after, {
      decision: data.decision,
    });

    return { ok: true, row: after };
  });

export const listAuditLogsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      page?: number;
      actor?: string;
      entityType?: string;
      action?: string;
      from?: string;
      to?: string;
    } | undefined) => ({
      page: Math.max(1, Math.floor(i?.page ?? 1)),
      actor: i?.actor ?? null,
      entityType: i?.entityType ?? null,
      action: i?.action ?? null,
      from: i?.from ?? null,
      to: i?.to ?? null,
    }),
  )
  .handler(async ({ data, context }) => {
    const perPage = 100;
    let q = (context.supabase as AdminSb)
      .from("audit_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((data.page - 1) * perPage, data.page * perPage - 1);
    if (data.actor) q = q.eq("actor_id", data.actor);
    if (data.entityType) q = q.eq("entity_type", data.entityType);
    if (data.action) q = q.ilike("action", `%${data.action}%`);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    const { data: rows, count, error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [], total: count ?? 0, page: data.page, perPage };
  });

// ─────────────────────────── SITE SETTINGS ─────────────────────────

const SETTING_KEYS = [
  "import.default_status",
  "import.preserve_curated_fields",
  "import.require_known_city",
  "import.require_category_mapping",
  "reviews.auto_publish",
  "images.queue_after_import",
] as const;

export const getSettingsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as AdminSb)
      .from("site_settings")
      .select("key, value, description, updated_at")
      .in("key", SETTING_KEYS as unknown as string[]);
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: data ?? [], keys: SETTING_KEYS };
  });

export const updateSettingAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { key: string; value: unknown }) => {
    if (!SETTING_KEYS.includes(i?.key as (typeof SETTING_KEYS)[number]))
      throw new Response("Unknown setting key", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as AdminSb)
      .from("site_settings")
      .upsert({ key: data.key, value: data.value as never, updated_at: new Date().toISOString() });
    if (error) throw new Response(error.message, { status: 400 });
    await audit((context.supabase as AdminSb), "settings.update", "site_setting", data.key, null, data.value, {});
    return { ok: true };
  });

// ─────────────────────────── Shared helpers exposed for pages ──────

export type { AppRole };
