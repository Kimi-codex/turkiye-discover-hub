import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Sb = any;

const uuid = z.string().uuid();
const localizedText = z
  .record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string().trim().max(4000))
  .default({});
const jsonObject = z.record(z.string(), z.unknown()).default({});

const submissionType = z.enum(["new_business", "existing_business_verification"]);
const draftStatus = z.enum(["draft", "changes_requested", "additional_documents_required"]);
const mutableStatus = z.enum(["draft", "submitted"]);

const draftPayload = z.object({
  id: uuid.optional(),
  submissionType,
  targetBusinessId: uuid.optional(),
  localeDraft: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  businessNameLocalized: localizedText,
  businessDescriptionLocalized: localizedText,
  categories: z.array(z.unknown()).max(20).default([]),
  servicesLocalized: jsonObject,
  attributes: jsonObject,
  contact: jsonObject,
  address: jsonObject,
  socialLinks: jsonObject,
  onboardingContent: jsonObject,
  commercialRegistrationNumber: z.string().trim().max(120).optional(),
  commercialRegistrationLegalName: z.string().trim().max(240).optional(),
  commercialRegistrationCountry: z.string().trim().max(120).optional(),
  commercialRegistrationIssuedAt: z.string().date().optional(),
  commercialRegistrationExpiresAt: z.string().date().optional(),
  applicantFullName: z.string().trim().max(200).optional(),
  applicantPhone: z.string().trim().max(40).optional(),
  applicantRole: z.string().trim().max(120).optional(),
  applicantBusinessEmail: z.string().trim().email().max(255).optional(),
  declarationAcceptedAt: z.string().datetime().optional(),
});

const uploadPayload = z.object({
  submissionId: uuid,
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
});

function errorCode(code: string, status = 400): never {
  throw new Response(code, { status });
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^\w.-]+/g, "_").slice(-120);
}

function submissionMutation(data: z.infer<typeof draftPayload>, userId: string, status: z.infer<typeof mutableStatus>) {
  return {
    applicant_id: userId,
    submission_type: data.submissionType,
    target_business_id: data.submissionType === "existing_business_verification" ? data.targetBusinessId : null,
    status,
    locale_draft: data.localeDraft ?? null,
    business_name_localized: data.businessNameLocalized,
    business_description_localized: data.businessDescriptionLocalized,
    categories: data.categories,
    services_localized: data.servicesLocalized,
    attributes: data.attributes,
    contact: data.contact,
    address: data.address,
    social_links: data.socialLinks,
    onboarding_content: data.onboardingContent,
    commercial_registration_number: data.commercialRegistrationNumber ?? null,
    commercial_registration_legal_name: data.commercialRegistrationLegalName ?? null,
    commercial_registration_country: data.commercialRegistrationCountry ?? null,
    commercial_registration_issued_at: data.commercialRegistrationIssuedAt ?? null,
    commercial_registration_expires_at: data.commercialRegistrationExpiresAt ?? null,
    applicant_full_name: data.applicantFullName ?? null,
    applicant_phone: data.applicantPhone ?? null,
    applicant_role: data.applicantRole ?? null,
    applicant_business_email: data.applicantBusinessEmail ?? null,
    declaration_accepted_at: data.declarationAcceptedAt ?? null,
  };
}

async function assertEditableSubmission(supabase: Sb, submissionId: string, userId: string) {
  const { data, error } = await supabase
    .from("business_onboarding_submissions")
    .select("id, applicant_id, status, submission_type, target_business_id, version")
    .eq("id", submissionId)
    .single();

  if (error || !data) errorCode("onboarding.error.submission_not_found", 404);
  if (data.applicant_id !== userId) errorCode("onboarding.error.submission_not_found", 404);
  if (!draftStatus.options.includes(data.status)) errorCode("onboarding.error.submission_locked", 409);
  return data;
}

async function assertTargetBusinessIsPubliclySelectable(supabase: Sb, submissionTypeValue: string, targetBusinessId?: string) {
  if (submissionTypeValue === "new_business") return;
  if (!targetBusinessId) errorCode("onboarding.error.target_business_required");

  const { data, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", targetBusinessId)
    .eq("status", "published")
    .maybeSingle();

  if (error) errorCode("onboarding.error.target_business_lookup_failed", 500);
  if (!data) errorCode("onboarding.error.target_business_not_found", 404);
}

async function validateSubmittable(supabase: Sb, submissionId: string) {
  const { data: submission, error: submissionError } = await supabase
    .from("business_onboarding_submissions")
    .select(
      "id, submission_type, target_business_id, business_name_localized, commercial_registration_number, commercial_registration_legal_name, commercial_registration_country, applicant_full_name, applicant_phone, applicant_role, applicant_business_email, declaration_accepted_at",
    )
    .eq("id", submissionId)
    .single();

  if (submissionError || !submission) errorCode("onboarding.error.submission_not_found", 404);
  if (submission.submission_type === "existing_business_verification" && !submission.target_business_id) {
    errorCode("onboarding.error.target_business_required");
  }
  if (submission.submission_type === "new_business") {
    const names = Object.values((submission.business_name_localized ?? {}) as Record<string, unknown>);
    if (!names.some((value) => typeof value === "string" && value.trim().length >= 2)) {
      errorCode("onboarding.error.business_name_required");
    }
  }
  if (!submission.commercial_registration_number?.trim()) errorCode("onboarding.error.registration_number_required");
  if (!submission.commercial_registration_legal_name?.trim()) errorCode("onboarding.error.registration_legal_name_required");
  if (!submission.commercial_registration_country?.trim()) errorCode("onboarding.error.registration_country_required");
  if (!submission.commercial_registration_expires_at) errorCode("onboarding.error.registration_expiry_required");
  if (!submission.applicant_full_name?.trim()) errorCode("onboarding.error.applicant_name_required");
  if (!submission.applicant_phone?.trim()) errorCode("onboarding.error.applicant_phone_required");
  if (!submission.applicant_role?.trim()) errorCode("onboarding.error.applicant_role_required");
  if (!submission.applicant_business_email?.trim()) errorCode("onboarding.error.applicant_email_required");
  if (!submission.declaration_accepted_at) errorCode("onboarding.error.declaration_required");

  const { count, error } = await supabase
    .from("business_onboarding_documents")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("document_type", "commercial_registration")
    .eq("status", "active");

  if (error) errorCode("onboarding.error.document_lookup_failed", 500);
  if (!count) errorCode("onboarding.error.registration_document_required");
}

export const listMyOnboardingSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Sb;
    const { data, error } = await supabase
      .from("business_onboarding_submissions")
      .select("id, submission_type, target_business_id, status, version, submitted_at, reviewed_at, approved_business_id, created_at, updated_at")
      .eq("applicant_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) errorCode("onboarding.error.list_failed", 500);
    return { rows: data ?? [] };
  });

export const searchOnboardingBusinesses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { query: string }) => ({
    query: z.string().trim().min(2).max(120).parse(i.query),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const q = data.query.replace(/[%_]/g, " ").replace(/,/g, " ").trim();
    const pattern = `%${q}%`;
    const { data: rows, error } = await supabase
      .from("businesses")
      .select("id, name, slug, formatted_address, rating, review_count, status")
      .eq("status", "published")
      .or(`name.ilike.${pattern},formatted_address.ilike.${pattern},slug.ilike.${pattern}`)
      .order("review_count", { ascending: false })
      .limit(8);
    if (error) errorCode("onboarding.error.search_failed", 500);
    return {
      rows: (rows ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        formatted_address: row.formatted_address,
        rating: row.rating,
        review_count: row.review_count,
      })),
    };
  });

export const getOnboardingSubmission = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { submissionId: string }) => ({ submissionId: uuid.parse(i.submissionId) }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    const { data: row, error } = await supabase
      .from("business_onboarding_submissions")
      .select("*, documents:business_onboarding_documents(*), images:business_onboarding_images(*), events:business_onboarding_events(*)")
      .eq("id", data.submissionId)
      .single();
    if (error || !row) errorCode("onboarding.error.submission_not_found", 404);
    if (row.applicant_id !== context.userId) errorCode("onboarding.error.submission_not_found", 404);
    return { row };
  });

export const saveOnboardingDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof draftPayload>) => draftPayload.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertTargetBusinessIsPubliclySelectable(supabase, data.submissionType, data.targetBusinessId);

    if (data.id) {
      const existing = await assertEditableSubmission(supabase, data.id, context.userId);
      if (existing.submission_type !== data.submissionType) errorCode("onboarding.error.submission_type_locked", 409);
      const updatePayload = {
        ...submissionMutation(data, context.userId, "draft"),
      };
      delete (updatePayload as Partial<typeof updatePayload>).applicant_id;
      delete (updatePayload as Partial<typeof updatePayload>).submission_type;
      delete (updatePayload as Partial<typeof updatePayload>).target_business_id;
      delete (updatePayload as Partial<typeof updatePayload>).status;

      const { data: row, error } = await supabase
        .from("business_onboarding_submissions")
        .update(updatePayload)
        .eq("id", data.id)
        .select()
        .single();
      if (error) errorCode("onboarding.error.save_failed", 400);
      return { row };
    }

    const { data: row, error } = await supabase
      .from("business_onboarding_submissions")
      .insert(submissionMutation(data, context.userId, "draft"))
      .select()
      .single();
    if (error) errorCode("onboarding.error.save_failed", 400);
    return { row };
  });

export const submitOnboardingDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { submissionId: string }) => ({ submissionId: uuid.parse(i.submissionId) }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertEditableSubmission(supabase, data.submissionId, context.userId);
    await validateSubmittable(supabase, data.submissionId);

    const { data: row, error } = await supabase.rpc("submit_business_onboarding_submission", {
      _submission_id: data.submissionId,
    });
    if (error) errorCode("onboarding.error.submit_failed", 400);
    return { row };
  });

export const createOnboardingDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof uploadPayload>) => uploadPayload.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertEditableSubmission(supabase, data.submissionId, context.userId);
    const path = `${context.userId}/submissions/${data.submissionId}/documents/${Date.now()}_${safeFileName(data.fileName)}`;
    const { data: signed, error } = await supabase.storage
      .from("business-verification-documents")
      .createSignedUploadUrl(path);
    if (error) errorCode("onboarding.error.upload_url_failed", 500);
    return { path, uploadUrl: signed.signedUrl, token: signed.token };
  });

export const registerOnboardingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: z.input<typeof uploadPayload> & { storagePath: string; documentType: "commercial_registration" | "additional_document"; sizeBytes?: number }) =>
      uploadPayload
        .extend({
          storagePath: z.string().trim().min(1).max(700),
          documentType: z.enum(["commercial_registration", "additional_document"]),
          sizeBytes: z.number().int().nonnegative().optional(),
        })
        .parse(i),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertEditableSubmission(supabase, data.submissionId, context.userId);
    if (!data.storagePath.startsWith(`${context.userId}/`)) errorCode("onboarding.error.invalid_storage_path");

    if (data.documentType === "commercial_registration") {
      const { error: prepError } = await supabase.rpc("prepare_business_onboarding_document_replacement", {
        _submission_id: data.submissionId,
        _document_type: "commercial_registration",
      });
      if (prepError) errorCode("onboarding.error.document_register_failed", 400);
    }

    const { data: row, error } = await supabase
      .from("business_onboarding_documents")
      .insert({
        submission_id: data.submissionId,
        uploaded_by: context.userId,
        document_type: data.documentType,
        storage_bucket: "business-verification-documents",
        storage_path: data.storagePath,
        original_filename: data.fileName,
        mime_type: data.contentType,
        size_bytes: data.sizeBytes ?? null,
      })
      .select()
      .single();
    if (error) errorCode("onboarding.error.document_register_failed", 400);

    return { row };
  });

export const createOnboardingImageUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof uploadPayload>) => uploadPayload.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertEditableSubmission(supabase, data.submissionId, context.userId);
    const path = `${context.userId}/submissions/${data.submissionId}/images/${Date.now()}_${safeFileName(data.fileName)}`;
    const { data: signed, error } = await supabase.storage
      .from("business-onboarding-images")
      .createSignedUploadUrl(path);
    if (error) errorCode("onboarding.error.upload_url_failed", 500);
    return { path, uploadUrl: signed.signedUrl, token: signed.token };
  });

export const registerOnboardingImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: z.input<typeof uploadPayload> & { storagePath: string; imageType?: "cover" | "gallery" | "logo"; sizeBytes?: number; width?: number; height?: number; sortOrder?: number }) =>
      uploadPayload
        .extend({
          storagePath: z.string().trim().min(1).max(700),
          imageType: z.enum(["cover", "gallery", "logo"]).optional(),
          sizeBytes: z.number().int().nonnegative().optional(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          sortOrder: z.number().int().min(0).max(9).optional(),
        })
        .parse(i),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Sb;
    await assertEditableSubmission(supabase, data.submissionId, context.userId);
    if (!data.storagePath.startsWith(`${context.userId}/`)) errorCode("onboarding.error.invalid_storage_path");

    const { data: row, error } = await supabase
      .from("business_onboarding_images")
      .insert({
        submission_id: data.submissionId,
        uploaded_by: context.userId,
        storage_bucket: "business-onboarding-images",
        storage_path: data.storagePath,
        original_filename: data.fileName,
        mime_type: data.contentType,
        size_bytes: data.sizeBytes ?? null,
        width: data.width ?? null,
        height: data.height ?? null,
        image_type: data.imageType ?? "gallery",
        sort_order: data.sortOrder ?? 0,
        status: "pending",
      })
      .select()
      .single();
    if (error) errorCode("onboarding.error.image_register_failed", 400);

    return { row };
  });
