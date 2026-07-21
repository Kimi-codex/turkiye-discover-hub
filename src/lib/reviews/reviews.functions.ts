import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SubmitReviewInput = {
  businessId: string;
  rating: number;
  reviewText: string;
  language?: string;
};

export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: SubmitReviewInput) => {
    if (!i?.businessId) throw new Response("Invalid business", { status: 400 });
    const rating = Math.round(Number(i.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5)
      throw new Response("Rating must be 1-5", { status: 400 });
    const text = String(i.reviewText ?? "").trim();
    if (text.length < 5) throw new Response("Review too short (min 5 chars)", { status: 400 });
    if (text.length > 2000) throw new Response("Review too long (max 2000 chars)", { status: 400 });
    const language = ["tr", "en", "ar"].includes(String(i.language)) ? (i.language as string) : "tr";
    return { businessId: i.businessId, rating, reviewText: text, language };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify business exists and is published
    const { data: biz, error: bErr } = await supabase
      .from("businesses")
      .select("id, status")
      .eq("id", data.businessId)
      .maybeSingle();
    if (bErr) throw new Response(bErr.message, { status: 500 });
    if (!biz || biz.status !== "published")
      throw new Response("Business unavailable", { status: 404 });

    // One platform review per user per business
    const { data: existing } = await supabase
      .from("reviews")
      .select("id, status")
      .eq("business_id", data.businessId)
      .eq("user_id", userId)
      .eq("source", "platform")
      .maybeSingle();
    if (existing) {
      return { ok: false as const, reason: "already_submitted" as const, status: existing.status };
    }

    const { error } = await supabase.from("reviews").insert({
      business_id: data.businessId,
      user_id: userId,
      source: "platform",
      rating: data.rating,
      review_text: data.reviewText,
      review_language: data.language,
      status: "pending",
    });
    if (error) throw new Response(error.message, { status: 400 });
    return { ok: true as const };
  });

export const getMyReviewForBusiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { businessId: string }) => {
    if (!i?.businessId) throw new Response("Invalid business", { status: 400 });
    return i;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("reviews")
      .select("id, rating, review_text, status, created_at")
      .eq("business_id", data.businessId)
      .eq("user_id", userId)
      .eq("source", "platform")
      .maybeSingle();
    return row;
  });
