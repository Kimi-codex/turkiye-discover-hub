import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, FileText, ImagePlus, Loader2, Search, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useLocaleContext, type MessageKey } from "@/lib/i18n";
import {
  createOnboardingDocumentUpload,
  createOnboardingImageUpload,
  getOnboardingSubmission,
  listMyOnboardingSubmissions,
  registerOnboardingDocument,
  registerOnboardingImage,
  saveOnboardingDraft,
  searchOnboardingBusinesses,
  submitOnboardingDraft,
} from "@/lib/onboarding/onboarding.functions";

export const Route = createFileRoute("/$lang/_authenticated/owner/onboarding")({
  ssr: false,
  component: OnboardingPage,
});

type SubmissionType = "new_business" | "existing_business_verification";
type BusinessSearchResult = {
  id: string;
  name: string;
  slug: string;
  formatted_address: string | null;
  rating: number | null;
  review_count: number;
};
type SubmissionSummary = {
  id: string;
  submission_type: SubmissionType;
  target_business_id: string | null;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_business_id: string | null;
  created_at: string;
  updated_at: string;
};
type SubmissionDetail = SubmissionSummary & {
  business_name_localized: Record<string, string>;
  business_description_localized: Record<string, string>;
  commercial_registration_number: string | null;
  commercial_registration_legal_name: string | null;
  commercial_registration_country: string | null;
  commercial_registration_issued_at: string | null;
  commercial_registration_expires_at: string | null;
  applicant_full_name: string | null;
  applicant_phone: string | null;
  applicant_role: string | null;
  applicant_business_email: string | null;
  applicant_message_key: string | null;
  applicant_message_params: Record<string, string | number> | null;
  declaration_accepted_at: string | null;
  documents?: Array<{ id: string; document_type: string; original_filename: string | null; status: string; created_at: string }>;
  images?: Array<{ id: string; image_type: string; original_filename: string | null; status: string; created_at: string }>;
  events?: Array<{ id: string; event_type: string; message_key: string | null; message_params: Record<string, string | number> | null; created_at: string }>;
};

const editableStatuses = new Set(["draft", "changes_requested", "additional_documents_required"]);

function OnboardingPage() {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const { locale, t } = useLocaleContext();
  const qc = useQueryClient();
  const listSubmissions = useServerFn(listMyOnboardingSubmissions);
  const getSubmission = useServerFn(getOnboardingSubmission);
  const searchBusinesses = useServerFn(searchOnboardingBusinesses);
  const saveDraft = useServerFn(saveOnboardingDraft);
  const submitDraft = useServerFn(submitOnboardingDraft);
  const createDocumentUpload = useServerFn(createOnboardingDocumentUpload);
  const registerDocument = useServerFn(registerOnboardingDocument);
  const createImageUpload = useServerFn(createOnboardingImageUpload);
  const registerImage = useServerFn(registerOnboardingImage);

  const submissions = useQuery({
    queryKey: ["onboarding", "submissions"],
    queryFn: () => listSubmissions(),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useQuery({
    queryKey: ["onboarding", "submission", selectedId],
    queryFn: () => getSubmission({ data: { submissionId: selectedId! } }),
    enabled: !!selectedId,
  });

  const [searchText, setSearchText] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessSearchResult | null>(null);
  const [submissionType, setSubmissionType] = useState<SubmissionType>("existing_business_verification");
  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registrationLegalName, setRegistrationLegalName] = useState("");
  const [registrationCountry, setRegistrationCountry] = useState("");
  const [registrationIssuedAt, setRegistrationIssuedAt] = useState("");
  const [registrationExpiresAt, setRegistrationExpiresAt] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [applicantPhone, setApplicantPhone] = useState("");
  const [applicantRole, setApplicantRole] = useState("");
  const [applicantEmail, setApplicantEmail] = useState("");
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  const detail = selected.data?.row as SubmissionDetail | undefined;
  const documents = detail?.documents ?? [];
  const images = detail?.images ?? [];
  const activeRegistrationDocument = documents.some(
    (doc) => doc.document_type === "commercial_registration" && doc.status === "active",
  );
  const activeImages = images.filter((image) => image.status !== "removed");
  const editable = !detail || editableStatuses.has(detail.status);

  useEffect(() => {
    if (!detail) return;
    setSubmissionType(detail.submission_type);
    setBusinessName(detail.business_name_localized?.[locale] ?? detail.business_name_localized?.en ?? "");
    setBusinessDescription(detail.business_description_localized?.[locale] ?? detail.business_description_localized?.en ?? "");
    setRegistrationNumber(detail.commercial_registration_number ?? "");
    setRegistrationLegalName(detail.commercial_registration_legal_name ?? "");
    setRegistrationCountry(detail.commercial_registration_country ?? "");
    setRegistrationIssuedAt(detail.commercial_registration_issued_at ?? "");
    setRegistrationExpiresAt(detail.commercial_registration_expires_at ?? "");
    setApplicantName(detail.applicant_full_name ?? "");
    setApplicantPhone(detail.applicant_phone ?? "");
    setApplicantRole(detail.applicant_role ?? "");
    setApplicantEmail(detail.applicant_business_email ?? "");
    setDeclarationAccepted(!!detail.declaration_accepted_at);
  }, [detail, locale]);

  const missingItems = useMemo(() => {
    const items: MessageKey[] = [];
    if (submissionType === "existing_business_verification" && !selectedBusiness && !detail?.target_business_id) {
      items.push("onboarding.missing.business_selection");
    }
    if (submissionType === "new_business" && businessName.trim().length < 2) {
      items.push("onboarding.missing.business_name");
    }
    if (!registrationNumber.trim()) items.push("onboarding.missing.registration_number");
    if (!registrationLegalName.trim()) items.push("onboarding.missing.registration_legal_name");
    if (!registrationCountry.trim()) items.push("onboarding.missing.registration_country");
    if (!registrationExpiresAt) items.push("onboarding.missing.registration_expiry");
    if (!applicantName.trim()) items.push("onboarding.missing.applicant_name");
    if (!applicantPhone.trim()) items.push("onboarding.missing.applicant_phone");
    if (!applicantRole.trim()) items.push("onboarding.missing.applicant_role");
    if (!applicantEmail.trim()) items.push("onboarding.missing.applicant_email");
    if (!activeRegistrationDocument) items.push("onboarding.missing.registration_document");
    if (!declarationAccepted) items.push("onboarding.missing.declaration");
    return items;
  }, [
    activeRegistrationDocument,
    applicantEmail,
    applicantName,
    applicantPhone,
    applicantRole,
    businessName,
    declarationAccepted,
    detail?.target_business_id,
    registrationCountry,
    registrationExpiresAt,
    registrationLegalName,
    registrationNumber,
    selectedBusiness,
    submissionType,
  ]);

  const requiredItemCount = 12;
  const completion = Math.max(0, Math.round(((requiredItemCount - missingItems.length) / requiredItemCount) * 100));

  const searchMutation = useMutation({
    mutationFn: () => searchBusinesses({ data: { query: searchText } }),
    onSuccess: () => setHasSearched(true),
    onError: (error) => toast.error(messageFromError(error, t)),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveDraft({
        data: buildDraftPayload({
          id: selectedId ?? undefined,
          submissionType,
          selectedBusiness,
          existingTargetBusinessId: detail?.target_business_id ?? undefined,
          locale,
          businessName,
          businessDescription,
          registrationNumber,
          registrationLegalName,
          registrationCountry,
          registrationIssuedAt,
          registrationExpiresAt,
          applicantName,
          applicantPhone,
          applicantRole,
          applicantEmail,
          declarationAccepted,
        }),
      }),
    onSuccess: async (result) => {
      const row = result.row as SubmissionDetail;
      setSelectedId(row.id);
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success(t("onboarding.toast.draft_saved"));
    },
    onError: (error) => toast.error(messageFromError(error, t)),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const currentId = selectedId ?? (await saveMutation.mutateAsync()).row.id;
      return submitDraft({ data: { submissionId: currentId } });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success(t("onboarding.toast.submitted"));
    },
    onError: (error) => toast.error(messageFromError(error, t)),
  });

  const documentUpload = useMutation({
    mutationFn: async (file: File) => {
      const id = await ensureDraftId();
      const contentType = file.type || "application/octet-stream";
      const signed = await createDocumentUpload({ data: { submissionId: id, fileName: file.name, contentType } });
      await uploadSignedFile(signed.uploadUrl, file, contentType);
      return registerDocument({
        data: {
          submissionId: id,
          fileName: file.name,
          contentType,
          storagePath: signed.path,
          documentType: "commercial_registration",
          sizeBytes: file.size,
        },
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success(t("onboarding.toast.document_uploaded"));
    },
    onError: (error) => toast.error(messageFromError(error, t)),
  });

  const imageUpload = useMutation({
    mutationFn: async (file: File) => {
      if (activeImages.length >= 10) throw new Error("onboarding.error.too_many_images");
      const id = await ensureDraftId();
      const contentType = file.type || "application/octet-stream";
      const signed = await createImageUpload({ data: { submissionId: id, fileName: file.name, contentType } });
      await uploadSignedFile(signed.uploadUrl, file, contentType);
      return registerImage({
        data: {
          submissionId: id,
          fileName: file.name,
          contentType,
          storagePath: signed.path,
          imageType: activeImages.length === 0 ? "cover" : "gallery",
          sizeBytes: file.size,
          sortOrder: activeImages.length,
        },
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success(t("onboarding.toast.image_uploaded"));
    },
    onError: (error) => toast.error(messageFromError(error, t)),
  });

  async function ensureDraftId() {
    if (selectedId) return selectedId;
    const result = await saveMutation.mutateAsync();
    return (result.row as SubmissionDetail).id;
  }

  const searchRows = (searchMutation.data?.rows ?? []) as BusinessSearchResult[];
  const summaries = (submissions.data?.rows ?? []) as SubmissionSummary[];

  return (
    <OwnerShell variant="applicant">
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t("onboarding.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
          </div>
          <Badge variant="outline">{t("onboarding.private_review")}</Badge>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Search className="h-5 w-5" />
                  {t("onboarding.search.title")}
                </CardTitle>
                <CardDescription>{t("onboarding.search.desc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (searchText.trim().length < 2) {
                      toast.error(t("onboarding.error.search_too_short"));
                      return;
                    }
                    searchMutation.mutate();
                  }}
                >
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder={t("onboarding.search.placeholder")}
                    disabled={!editable}
                  />
                  <Button type="submit" disabled={!editable || searchMutation.isPending}>
                    {searchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    {t("onboarding.search.button")}
                  </Button>
                </form>

                {searchRows.length > 0 ? (
                  <div className="grid gap-2">
                    {searchRows.map((business) => (
                      <button
                        key={business.id}
                        type="button"
                        disabled={!editable}
                        onClick={() => {
                          setSubmissionType("existing_business_verification");
                          setSelectedBusiness(business);
                        }}
                        className="rounded-lg border p-3 text-start transition hover:bg-muted disabled:opacity-60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{business.name}</div>
                            <div className="text-xs text-muted-foreground">{business.formatted_address || `/${business.slug}`}</div>
                          </div>
                          {selectedBusiness?.id === business.id ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {t("onboarding.search.rating", {
                            rating: Number(business.rating ?? 0).toFixed(1),
                            count: business.review_count ?? 0,
                          })}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : hasSearched ? (
                  <Alert>
                    <Building2 className="h-4 w-4" />
                    <AlertTitle>{t("onboarding.search.empty_title")}</AlertTitle>
                    <AlertDescription>{t("onboarding.search.empty_desc")}</AlertDescription>
                  </Alert>
                ) : null}

                {hasSearched ? (
                  <RadioGroup
                    value={submissionType}
                    onValueChange={(value) => setSubmissionType(value as SubmissionType)}
                    className="grid gap-2 sm:grid-cols-2"
                    disabled={!editable}
                  >
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                      <RadioGroupItem value="existing_business_verification" />
                      <span>
                        <span className="block font-medium">{t("onboarding.choice.existing")}</span>
                        <span className="block text-xs text-muted-foreground">{t("onboarding.choice.existing_desc")}</span>
                      </span>
                    </Label>
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                      <RadioGroupItem value="new_business" />
                      <span>
                        <span className="block font-medium">{t("onboarding.choice.new")}</span>
                        <span className="block text-xs text-muted-foreground">{t("onboarding.choice.new_desc")}</span>
                      </span>
                    </Label>
                  </RadioGroup>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("onboarding.form.title")}</CardTitle>
                <CardDescription>{t("onboarding.form.desc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {submissionType === "new_business" ? (
                  <div className="grid gap-4">
                    <Field label={t("onboarding.field.business_name")} required>
                      <Input value={businessName} onChange={(event) => setBusinessName(event.target.value)} disabled={!editable} />
                    </Field>
                    <Field label={t("onboarding.field.business_description")}>
                      <Textarea value={businessDescription} onChange={(event) => setBusinessDescription(event.target.value)} rows={3} disabled={!editable} />
                    </Field>
                  </div>
                ) : (
                  <Alert>
                    <Building2 className="h-4 w-4" />
                    <AlertTitle>
                      {selectedBusiness?.name ??
                        (detail?.target_business_id
                          ? t("onboarding.form.selected_existing_resume")
                          : t("onboarding.form.selected_existing_title"))}
                    </AlertTitle>
                    <AlertDescription>
                      {selectedBusiness?.formatted_address ?? t("onboarding.form.selected_existing_desc")}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("onboarding.field.registration_number")} required>
                    <Input value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} disabled={!editable} />
                  </Field>
                  <Field label={t("onboarding.field.registration_country")} required>
                    <Input value={registrationCountry} onChange={(event) => setRegistrationCountry(event.target.value)} disabled={!editable} />
                  </Field>
                  <Field label={t("onboarding.field.registration_legal_name")} required>
                    <Input value={registrationLegalName} onChange={(event) => setRegistrationLegalName(event.target.value)} disabled={!editable} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("onboarding.field.registration_issued_at")}>
                      <Input type="date" value={registrationIssuedAt} onChange={(event) => setRegistrationIssuedAt(event.target.value)} disabled={!editable} />
                    </Field>
                    <Field label={t("onboarding.field.registration_expires_at")}>
                      <Input type="date" value={registrationExpiresAt} onChange={(event) => setRegistrationExpiresAt(event.target.value)} disabled={!editable} />
                    </Field>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("onboarding.field.applicant_name")} required>
                    <Input value={applicantName} onChange={(event) => setApplicantName(event.target.value)} disabled={!editable} />
                  </Field>
                  <Field label={t("onboarding.field.applicant_role")} required>
                    <Input value={applicantRole} onChange={(event) => setApplicantRole(event.target.value)} disabled={!editable} />
                  </Field>
                  <Field label={t("onboarding.field.applicant_phone")} required>
                    <Input value={applicantPhone} onChange={(event) => setApplicantPhone(event.target.value)} disabled={!editable} />
                  </Field>
                  <Field label={t("onboarding.field.applicant_email")} required>
                    <Input type="email" value={applicantEmail} onChange={(event) => setApplicantEmail(event.target.value)} disabled={!editable} />
                  </Field>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{t("onboarding.documents.title")}</div>
                      <div className="text-xs text-muted-foreground">{t("onboarding.documents.desc")}</div>
                    </div>
                    <Button asChild type="button" variant="outline" size="sm" disabled={!editable || documentUpload.isPending}>
                      <Label className="cursor-pointer">
                        {documentUpload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {t("onboarding.documents.upload")}
                        <input
                          className="sr-only"
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp"
                          disabled={!editable || documentUpload.isPending}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) documentUpload.mutate(file);
                            event.target.value = "";
                          }}
                        />
                      </Label>
                    </Button>
                  </div>
                  <EvidenceList
                    rows={documents}
                    empty={t("onboarding.documents.empty")}
                    icon={<FileText className="h-4 w-4" />}
                    t={t}
                  />
                </div>

                <div className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{t("onboarding.images.title")}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("onboarding.images.count", { count: activeImages.length })}
                      </div>
                    </div>
                    <Button asChild type="button" variant="outline" size="sm" disabled={!editable || imageUpload.isPending || activeImages.length >= 10}>
                      <Label className="cursor-pointer">
                        {imageUpload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                        {t("onboarding.images.upload")}
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={!editable || imageUpload.isPending || activeImages.length >= 10}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) imageUpload.mutate(file);
                            event.target.value = "";
                          }}
                        />
                      </Label>
                    </Button>
                  </div>
                  <EvidenceList
                    rows={images}
                    empty={t("onboarding.images.empty")}
                    icon={<ImagePlus className="h-4 w-4" />}
                    t={t}
                  />
                </div>

                <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={declarationAccepted}
                    onChange={(event) => setDeclarationAccepted(event.target.checked)}
                    disabled={!editable}
                  />
                  <span className="text-sm">{t("onboarding.declaration")}</span>
                </Label>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="outline" onClick={() => saveMutation.mutate()} disabled={!editable || saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t("onboarding.action.save")}
                  </Button>
                  <Button type="button" onClick={() => submitMutation.mutate()} disabled={!editable || submitMutation.isPending || missingItems.length > 0}>
                    {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {t("onboarding.action.submit")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("onboarding.dashboard.title")}</CardTitle>
                <CardDescription>{t("onboarding.dashboard.desc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={completion} />
                <div className="text-sm text-muted-foreground">{t("onboarding.dashboard.completion", { percent: completion })}</div>
                {missingItems.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {missingItems.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-destructive" />
                        <span>{t(item)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("onboarding.dashboard.ready")}
                  </div>
                )}
                {detail?.applicant_message_key ? (
                  <Alert>
                    <AlertTitle>{t("onboarding.admin_message.title")}</AlertTitle>
                    <AlertDescription>
                      {t(detail.applicant_message_key as MessageKey, detail.applicant_message_params ?? undefined)}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("onboarding.submissions.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                {submissions.isLoading ? (
                  <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
                ) : summaries.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    {t("onboarding.submissions.empty")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {summaries.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full rounded-lg border p-3 text-start hover:bg-muted"
                        onClick={() => setSelectedId(item.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {t(`onboarding.type.${item.submission_type}` as MessageKey)}
                          </span>
                          <Badge variant={statusVariant(item.status)}>
                            {t(`onboarding.status.${item.status}` as MessageKey)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(item.updated_at).toLocaleString(lang || locale)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("onboarding.events.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                {(detail?.events ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    {t("onboarding.events.empty")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(detail?.events ?? []).map((event) => (
                      <div key={event.id} className="border-b pb-3 text-sm last:border-0 last:pb-0">
                        <div className="font-medium">
                          {event.message_key
                            ? t(event.message_key as MessageKey, event.message_params ?? undefined)
                            : t("onboarding.events.item")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(event.created_at).toLocaleString(lang || locale)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </OwnerShell>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

function EvidenceList({
  rows,
  empty,
  icon,
  t,
}: {
  rows: Array<{ id: string; original_filename: string | null; status: string; created_at: string }>;
  empty: string;
  icon: React.ReactNode;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="truncate">{row.original_filename ?? row.id}</span>
          </span>
          <Badge variant="outline">{t(`onboarding.asset_status.${row.status}` as MessageKey)}</Badge>
        </li>
      ))}
    </ul>
  );
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  if (status === "under_review" || status === "submitted") return "secondary";
  return "outline";
}

function buildDraftPayload(input: {
  id?: string;
  submissionType: SubmissionType;
  selectedBusiness: BusinessSearchResult | null;
  existingTargetBusinessId?: string;
  locale: string;
  businessName: string;
  businessDescription: string;
  registrationNumber: string;
  registrationLegalName: string;
  registrationCountry: string;
  registrationIssuedAt: string;
  registrationExpiresAt: string;
  applicantName: string;
  applicantPhone: string;
  applicantRole: string;
  applicantEmail: string;
  declarationAccepted: boolean;
}) {
  return {
    id: input.id,
    submissionType: input.submissionType,
    targetBusinessId:
      input.submissionType === "existing_business_verification"
        ? input.selectedBusiness?.id ?? input.existingTargetBusinessId
        : undefined,
    localeDraft: input.locale,
    businessNameLocalized: input.businessName.trim() ? { [input.locale]: input.businessName.trim() } : {},
    businessDescriptionLocalized: input.businessDescription.trim() ? { [input.locale]: input.businessDescription.trim() } : {},
    categories: [],
    servicesLocalized: {},
    attributes: {},
    contact: {},
    address: {},
    socialLinks: {},
    onboardingContent: {},
    commercialRegistrationNumber: input.registrationNumber.trim() || undefined,
    commercialRegistrationLegalName: input.registrationLegalName.trim() || undefined,
    commercialRegistrationCountry: input.registrationCountry.trim() || undefined,
    commercialRegistrationIssuedAt: input.registrationIssuedAt || undefined,
    commercialRegistrationExpiresAt: input.registrationExpiresAt || undefined,
    applicantFullName: input.applicantName.trim() || undefined,
    applicantPhone: input.applicantPhone.trim() || undefined,
    applicantRole: input.applicantRole.trim() || undefined,
    applicantBusinessEmail: input.applicantEmail.trim() || undefined,
    declarationAcceptedAt: input.declarationAccepted ? new Date().toISOString() : undefined,
  };
}

async function uploadSignedFile(uploadUrl: string, file: File, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: file,
  });
  if (!response.ok) throw new Error("onboarding.error.upload_failed");
}

function messageFromError(error: unknown, t: (key: MessageKey, vars?: Record<string, string | number>) => string) {
  const message = error instanceof Error ? error.message : String(error);
  const key = message.includes("onboarding.") ? message.slice(message.indexOf("onboarding.")) : message;
  if (key.startsWith("onboarding.")) return t(key as MessageKey);
  return t("onboarding.error.generic");
}
