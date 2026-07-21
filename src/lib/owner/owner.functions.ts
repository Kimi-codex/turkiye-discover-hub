/**
 * Owner portal server functions.
 *
 * INVARIANTS (enforced on every business-scoped fn):
 *   1. `.middleware([requireSupabaseAuth])` — caller must be signed in.
 *   2. `assertOwns(supabase, input.businessId)` runs BEFORE any read/write.
 *   3. Owners NEVER write to `public.businesses` directly. Every mutation
 *      goes through `business_change_requests` and admin approval via the
 *      `apply_business_change_request` RPC.
 *   4. Client-supplied `businessId` is validated by `assertOwns` — RLS on
 *      `businesses` is the second line of defense.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwns } from "./authz.server";
import {
  REQUEST_TYPES,
  schemaFor,
  BUSINESS_FIELD_KEYS,
  type RequestType,
} from "./field-allowlists";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const uuid = z.string().uuid();

// ─────────────────────────── Overview ──────────────────────────

/** List businesses currently owned by the caller. */
export const listMyBusinesses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Sb;
    const { data, error } = await supabase
      .from("businesses")
      .select(
        "id, name, slug, status, verified, featured, rating, review_count, primary_category_id, city_id, updated_at",
      )
      .eq("owner_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: data ?? [] };
  });

/** Full business snapshot (owner view). */
export const getOwnedBusiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { businessId: string }) => ({
    businessId: uuid.parse(i.businessId),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    const [biz, hours, services, attrs, images, trans] = await Promise.all([
      supabase.from("businesses").select("*").eq("id", data.businessId).single(),
      supabase
        .from("business_opening_hours")
        .select("*")
        .eq("business_id", data.businessId)
        .order("day_of_week"),
      supabase.from("business_services").select("*").eq("business_id", data.businessId),
      supabase.from("business_attributes").select("*").eq("business_id", data.businessId),
      supabase
        .from("business_images")
        .select("*")
        .eq("business_id", data.businessId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true }),
      supabase.from("business_translations").select("*").eq("business_id", data.businessId),
    ]);
    if (biz.error) throw new Response(biz.error.message, { status: 500 });
    return {
      business: biz.data,
      hours: hours.data ?? [],
      services: services.data ?? [],
      attributes: attrs.data ?? [],
      images: images.data ?? [],
      translations: trans.data ?? [],
    };
  });

// ──────────────────────── Change requests ──────────────────────

const requestTypeEnum = z.enum(REQUEST_TYPES);

/** Submit a new change request. Payload is validated against the type. */
export const submitChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { businessId: string; requestType: RequestType; payload: unknown }) => ({
      businessId: uuid.parse(i.businessId),
      requestType: requestTypeEnum.parse(i.requestType),
      payload: i.payload,
    }),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    // Strict payload validation per type — unknown keys rejected.
    const parsed = schemaFor(data.requestType).parse(data.payload);

    // For business_fields, snapshot ORIGINAL values from the current row so the
    // RPC can detect stale-value conflicts at approval time.
    let originalValues: Record<string, unknown> = {};
    if (data.requestType === "business_fields") {
      const cols = Object.keys(parsed as Record<string, unknown>).filter((k) =>
        (BUSINESS_FIELD_KEYS as readonly string[]).includes(k),
      );
      if (cols.length > 0) {
        const { data: cur, error: curErr } = await supabase
          .from("businesses")
          .select(cols.join(","))
          .eq("id", data.businessId)
          .single();
        if (curErr) throw new Response(curErr.message, { status: 500 });
        originalValues = (cur ?? {}) as Record<string, unknown>;
      }
    }

    const { data: row, error } = await supabase
      .from("business_change_requests")
      .insert({
        business_id: data.businessId,
        submitted_by: context.userId,
        request_type: data.requestType,
        changes: parsed,
        original_values: originalValues,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Response(error.message, { status: 400 });
    return { row };
  });

/** List change requests for one business (owner view). */
export const listMyChangeRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { businessId: string }) => ({
    businessId: uuid.parse(i.businessId),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    const { data: rows, error } = await supabase
      .from("business_change_requests")
      .select("*")
      .eq("business_id", data.businessId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [] };
  });

/** Owner may withdraw a still-pending request they submitted. */
export const withdrawChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { requestId: string }) => ({
    requestId: uuid.parse(i.requestId),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    // Load the CR first to authorize by business
    const { data: cr, error: crErr } = await supabase
      .from("business_change_requests")
      .select("id, business_id, submitted_by, status")
      .eq("id", data.requestId)
      .single();
    if (crErr || !cr) throw new Response("Not found", { status: 404 });
    if (cr.submitted_by !== context.userId)
      throw new Response("Forbidden", { status: 403 });
    if (cr.status !== "pending")
      throw new Response("Only pending requests can be withdrawn", { status: 409 });
    // Belt-and-braces: still assert ownership at the time of withdrawal.
    await assertOwns(supabase, cr.business_id);
    const { error } = await supabase
      .from("business_change_requests")
      .update({ status: "withdrawn", reviewed_at: new Date().toISOString() })
      .eq("id", data.requestId)
      .eq("submitted_by", context.userId)
      .eq("status", "pending");
    if (error) throw new Response(error.message, { status: 400 });
    return { ok: true };
  });

// ────────────────────────── Ownership claims ───────────────────

const claimSchema = z.object({
  businessId: uuid,
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(40).optional(),
  businessEmail: z.string().trim().email().max(255),
  evidenceUrls: z.array(z.string().min(1).max(500)).max(10).default([]),
  message: z.string().trim().max(2000).optional(),
});

export const submitOwnershipClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof claimSchema>) => claimSchema.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    // Any signed-in, non-suspended user may claim. Verify existence + not
    // already owned by someone else in one query.
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .select("id, owner_id, status")
      .eq("id", data.businessId)
      .single();
    if (bizErr || !biz) throw new Response("Business not found", { status: 404 });
    if (biz.owner_id && biz.owner_id !== context.userId)
      throw new Response("Business already has an owner", { status: 409 });

    const { data: existing } = await supabase
      .from("ownership_claims")
      .select("id, status")
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) throw new Response("You already have a pending claim", { status: 409 });

    const { data: row, error } = await supabase
      .from("ownership_claims")
      .insert({
        business_id: data.businessId,
        user_id: context.userId,
        full_name: data.fullName,
        phone: data.phone ?? null,
        business_email: data.businessEmail,
        evidence_urls: data.evidenceUrls,
        message: data.message ?? null,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Response(error.message, { status: 400 });
    return { row };
  });

/** Private signed-upload URL under owner-uploads/claims/{uid}/… */
export const createClaimEvidenceUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { fileName: string; contentType: string }) => ({
    fileName: z.string().trim().min(1).max(200).parse(i.fileName),
    contentType: z.string().trim().min(1).max(120).parse(i.contentType),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const safe = data.fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `claims/${context.userId}/${Date.now()}_${safe}`;
    const { data: signed, error } = await supabase.storage
      .from("owner-uploads")
      .createSignedUploadUrl(path);
    if (error) throw new Response(error.message, { status: 500 });
    return { path, uploadUrl: signed.signedUrl, token: signed.token };
  });

export const listMyOwnershipClaims = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Sb;
    const { data, error } = await supabase
      .from("ownership_claims")
      .select("id, business_id, status, created_at, reviewed_at, admin_notes")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: data ?? [] };
  });

// ─────────────────── Owner private image uploads ───────────────

/** Create a signed upload URL under owner-uploads/{business_id}/…
 *  After upload the owner calls `submitImageRequest` (image_request CR). */
export const createOwnerImageUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { businessId: string; fileName: string }) => ({
    businessId: uuid.parse(i.businessId),
    fileName: z.string().trim().min(1).max(200).parse(i.fileName),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    const safe = data.fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${data.businessId}/${Date.now()}_${context.userId}_${safe}`;
    const { data: signed, error } = await supabase.storage
      .from("owner-uploads")
      .createSignedUploadUrl(path);
    if (error) throw new Response(error.message, { status: 500 });
    return { path, uploadUrl: signed.signedUrl, token: signed.token };
  });

/** Register an owner-uploaded image so the Phase 4 worker will normalize
 *  and publish it. The row starts as pending; admin approval flips it to
 *  visible via an image_request CR. */
export const registerOwnerImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { businessId: string; storagePath: string; contentType: string; title?: string }) => ({
      businessId: uuid.parse(i.businessId),
      storagePath: z.string().min(1).max(500).parse(i.storagePath),
      contentType: z.string().min(1).max(120).parse(i.contentType),
      title: z.string().trim().max(200).optional().parse(i.title),
    }),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    // Register the image row (pending status; not shown publicly until
    // storage_status='uploaded' AND is_cover/sort_order approved by admin).
    const { data: img, error } = await supabase
      .from("business_images")
      .insert({
        business_id: data.businessId,
        place_id: `owner-${context.userId}`,
        source_type: "owner_upload",
        source_provider: "owner_upload",
        source_url: null,
        source_title: data.title ?? null,
        content_type: data.contentType,
        storage_status: "pending",
        is_cover: false,
        sort_order: 999,
      })
      .select()
      .single();
    if (error) throw new Response(error.message, { status: 400 });
    return { image: img };
  });

// ─────────────────────── Reviews & replies ─────────────────────

/** Reviews on any of the owner's businesses. */
export const listOwnedReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { businessId: string }) => ({
    businessId: uuid.parse(i.businessId),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    const [rev, rep] = await Promise.all([
      supabase
        .from("reviews")
        .select("*")
        .eq("business_id", data.businessId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("review_replies")
        .select("*")
        .eq("business_id", data.businessId)
        .in("status", ["pending", "approved"]),
    ]);
    if (rev.error) throw new Response(rev.error.message, { status: 500 });
    return { reviews: rev.data ?? [], replies: rep.data ?? [] };
  });

const replySchema = z.object({
  reviewId: uuid,
  businessId: uuid,
  body: z.string().trim().min(2).max(2000),
});

/** Submit ONE active reply per review. Repeat submissions rejected while
 *  an existing pending/approved reply from any owner exists for the review. */
export const submitReviewReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof replySchema>) => replySchema.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    // Verify review belongs to this business (belt-and-braces).
    const { data: r, error: rErr } = await supabase
      .from("reviews")
      .select("id, business_id")
      .eq("id", data.reviewId)
      .single();
    if (rErr || !r) throw new Response("Review not found", { status: 404 });
    if (r.business_id !== data.businessId)
      throw new Response("Review/business mismatch", { status: 400 });

    // One active reply per review invariant.
    const { data: existing } = await supabase
      .from("review_replies")
      .select("id, status")
      .eq("review_id", data.reviewId)
      .in("status", ["pending", "approved"])
      .maybeSingle();
    if (existing)
      throw new Response("An active reply already exists for this review", {
        status: 409,
      });

    const { data: row, error } = await supabase
      .from("review_replies")
      .insert({
        review_id: data.reviewId,
        business_id: data.businessId,
        author_id: context.userId,
        body: data.body,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Response(error.message, { status: 400 });
    return { row };
  });

/** Withdraw an owner's own pending reply. */
export const withdrawReviewReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { replyId: string }) => ({ replyId: uuid.parse(i.replyId) }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: rep, error: repErr } = await supabase
      .from("review_replies")
      .select("id, business_id, author_id, status")
      .eq("id", data.replyId)
      .single();
    if (repErr || !rep) throw new Response("Not found", { status: 404 });
    if (rep.author_id !== context.userId)
      throw new Response("Forbidden", { status: 403 });
    if (rep.status !== "pending")
      throw new Response("Only pending replies can be withdrawn", { status: 409 });
    await assertOwns(supabase, rep.business_id);
    const { error } = await supabase
      .from("review_replies")
      .update({ status: "withdrawn" })
      .eq("id", data.replyId)
      .eq("author_id", context.userId);
    if (error) throw new Response(error.message, { status: 400 });
    return { ok: true };
  });

// ───────────────────── Owner reports (moderation) ──────────────

const reportSchema = z.object({
  businessId: uuid,
  reviewId: uuid.optional(),
  imageId: uuid.optional(),
  reportType: z.enum(["review", "image", "other"]),
  message: z.string().trim().min(5).max(2000),
});

export const ownerSubmitReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof reportSchema>) => reportSchema.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertOwns(supabase, data.businessId);
    const { data: row, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: context.userId,
        business_id: data.businessId,
        review_id: data.reviewId ?? null,
        image_id: data.imageId ?? null,
        report_type: data.reportType,
        message: data.message,
        status: "open",
      })
      .select()
      .single();
    if (error) throw new Response(error.message, { status: 400 });
    return { row };
  });

// ───────────────────────── Notifications ───────────────────────

export const listOwnerNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Sb;
    const { data, error } = await supabase
      .from("owner_notifications")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Response(error.message, { status: 500 });
    const unread = (data ?? []).filter((n: { read_at: string | null }) => !n.read_at).length;
    return { rows: data ?? [], unread };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: uuid.parse(i.id) }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { error } = await supabase
      .from("owner_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Response(error.message, { status: 400 });
    return { ok: true };
  });
