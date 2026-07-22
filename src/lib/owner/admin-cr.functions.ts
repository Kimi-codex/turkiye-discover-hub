/**
 * Admin-side moderation of owner change requests and review replies.
 * All server fns require the admin role via `requireAdmin`.
 *
 * The heavy work (per-field allowlist, conflict detection, atomic apply,
 * field_sources update, owner notification, audit log) lives in the
 * `apply_business_change_request` DB RPC.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin.middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const uuid = z.string().uuid();

export const listChangeRequestsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: { status?: string; requestType?: string; page?: number } | undefined) => ({
      status: i?.status ?? "pending",
      requestType: i?.requestType ?? null,
      page: Math.max(1, Math.floor(i?.page ?? 1)),
    }),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const perPage = 25;
    let q = supabase
      .from("business_change_requests")
      .select(
        "id, business_id, request_type, status, submitted_by, created_at, reviewed_at, businesses:business_id(name, slug)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((data.page - 1) * perPage, data.page * perPage - 1);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.requestType) q = q.eq("request_type", data.requestType);
    const { data: rows, error, count } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: rows ?? [], count: count ?? 0, page: data.page, perPage };
  });

export const getChangeRequestAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((i: { id: string }) => ({ id: uuid.parse(i.id) }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: cr, error } = await supabase
      .from("business_change_requests")
      .select("*, businesses:business_id(id, name, slug, status, owner_id)")
      .eq("id", data.id)
      .single();
    if (error) throw new Response(error.message, { status: 404 });
    return { cr };
  });

/** Apply approved fields via the atomic RPC. Returns conflict info verbatim
 *  when the DB detects a stale-value collision — caller must re-fetch. */
export const applyChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: {
      id: string;
      approve?: string[];
      reject?: string[];
      adminNotes?: string;
    }) => ({
      id: uuid.parse(i.id),
      approve: Array.isArray(i.approve) ? i.approve.map(String) : [],
      reject: Array.isArray(i.reject) ? i.reject.map(String) : [],
      adminNotes: z.string().max(4000).optional().parse(i.adminNotes),
    }),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: res, error } = await supabase.rpc(
      "apply_business_change_request",
      {
        _request_id: data.id,
        _approve: data.approve,
        _reject: data.reject,
        _admin_notes: data.adminNotes ?? null,
      },
    );
    if (error) throw new Response(error.message, { status: 400 });
    // { conflict:true, field, current, snapshot } OR { ok:true, status, approved, rejected }
    return res;
  });

// ─── review reply moderation ───

export const listPendingRepliesAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Sb;
    const { data, error } = await supabase
      .from("review_replies")
      .select("*, businesses:business_id(name, slug), reviews:review_id(rating, review_text)")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Response(error.message, { status: 500 });
    return { rows: data ?? [] };
  });

export const moderateReplyAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(
    (i: { replyId: string; approve: boolean; notes?: string }) => ({
      replyId: uuid.parse(i.replyId),
      approve: !!i.approve,
      notes: z.string().max(2000).optional().parse(i.notes),
    }),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: reply, error: rErr } = await supabase
      .from("review_replies")
      .select("id, status, business_id, author_id")
      .eq("id", data.replyId)
      .single();
    if (rErr || !reply) throw new Response("Not found", { status: 404 });
    if (reply.status !== "pending_review")
      throw new Response("Already moderated", { status: 409 });
    const { error } = await supabase
      .from("review_replies")
      .update({
        status: data.approve ? "published" : "rejected",
        moderated_by: context.userId,
        moderated_at: new Date().toISOString(),
        moderation_notes: data.notes ?? null,
      })
      .eq("id", data.replyId);
    if (error) throw new Response(error.message, { status: 400 });
    // Notify owner
    await supabase.from("owner_notifications").insert({
      user_id: reply.author_id,
      business_id: reply.business_id,
      kind: `review_reply.${data.approve ? "published" : "rejected"}`,
      payload: { reply_id: reply.id, notes: data.notes ?? null },
    });
    return { ok: true };
  });

// ─── ownership revocation ───

export const revokeOwnershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((i: { businessId: string; reason: string }) => ({
    businessId: uuid.parse(i.businessId),
    reason: z.string().trim().min(3).max(2000).parse(i.reason),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: res, error } = await supabase.rpc("revoke_ownership", {
      _business_id: data.businessId,
      _reason: data.reason,
    });
    if (error) throw new Response(error.message, { status: 400 });
    return res;
  });
