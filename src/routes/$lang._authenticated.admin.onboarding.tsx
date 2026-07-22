import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBusinessOnboardingAssetUrlAdmin,
  getBusinessOnboardingAdmin,
  listBusinessOnboardingAdmin,
  reviewBusinessOnboardingAdmin,
} from "@/lib/admin/domain.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const statuses = [
  "submitted",
  "under_review",
  "changes_requested",
  "additional_documents_required",
  "approved",
  "rejected",
  "withdrawn",
  "all",
] as const;

export const Route = createFileRoute("/$lang/_authenticated/admin/onboarding")({
  ssr: false,
  component: AdminOnboardingPage,
});

function AdminOnboardingPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>("submitted");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [privateNotes, setPrivateNotes] = useState("");
  const [applicantMessage, setApplicantMessage] = useState("");

  const list = useQuery({
    queryKey: ["admin", "business-onboarding", status],
    queryFn: () => listBusinessOnboardingAdmin({ data: { status } }),
  });
  const detail = useQuery({
    queryKey: ["admin", "business-onboarding-detail", selectedId],
    queryFn: () => getBusinessOnboardingAdmin({ data: { id: selectedId! } }),
    enabled: Boolean(selectedId),
  });
  const review = useMutation({
    mutationFn: (
      decision:
        | "mark_under_review"
        | "changes_requested"
        | "additional_documents_required"
        | "reject"
        | "approve_existing"
        | "approve_new_business",
    ) =>
      reviewBusinessOnboardingAdmin({
        data: {
          id: selectedId!,
          decision,
          applicantMessageKey: applicantMessage.trim() ? "onboarding.event.admin_message" : undefined,
          applicantMessageParams: applicantMessage.trim() ? { message: applicantMessage.trim() } : undefined,
          privateNotes: privateNotes.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success("Updated");
      await qc.invalidateQueries({ queryKey: ["admin", "business-onboarding"] });
      await qc.invalidateQueries({ queryKey: ["admin", "business-onboarding-detail", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data?.rows ?? [];
  const row = detail.data?.row as Record<string, unknown> | undefined;
  const targetBusiness = detail.data?.targetBusiness as Record<string, unknown> | null | undefined;
  const documents = ((row?.documents as Array<Record<string, unknown>> | undefined) ?? []).filter((d) => d.status !== "removed");
  const images = ((row?.images as Array<Record<string, unknown>> | undefined) ?? []).filter((i) => i.status !== "removed");
  const events = (row?.events as Array<Record<string, unknown>> | undefined) ?? [];
  const isReviewable = row && ["submitted", "under_review"].includes(String(row.status));
  const canApproveExisting = isReviewable && row?.submission_type === "existing_business_verification";
  const canApproveNewBusiness = isReviewable && row?.submission_type === "new_business";

  async function openAsset(kind: "document" | "image", id: unknown) {
    try {
      const { url } = await getBusinessOnboardingAssetUrlAdmin({ data: { kind, id: String(id) } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open asset");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Business onboarding</h1>
          <p className="text-sm text-muted-foreground">Review submitted business verification and onboarding requests.</p>
        </div>
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof statuses)[number])}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          {rows.map((item: Record<string, unknown>) => (
            <button
              key={String(item.id)}
              type="button"
              className="w-full rounded-xl border bg-card p-4 text-left hover:bg-muted/40"
              onClick={() => setSelectedId(String(item.id))}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{businessName(item)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {String(item.submission_type)} · applicant <span className="font-mono">{String(item.applicant_id)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {String(item.applicant_full_name ?? "No applicant name")} · {String(item.applicant_business_email ?? "No email")}
                  </div>
                </div>
                <Badge variant="outline">{String(item.status)}</Badge>
              </div>
            </button>
          ))}
          {rows.length === 0 && !list.isLoading && (
            <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">No submissions</div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review</CardTitle>
            <CardDescription>{selectedId ? "Submission details and admin decision" : "Select a submission"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {row ? (
              <>
                <section className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{businessName(row)}</span>
                    <Badge variant="outline">{String(row.status)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {String(row.submission_type)} · version {String(row.version)}
                  </div>
                  {targetBusiness && (
                    <div className="rounded-md border p-2 text-xs">
                      Target: {String(targetBusiness.name)} · {String(targetBusiness.status)} · owner{" "}
                      <span className="font-mono">{String(targetBusiness.owner_id ?? "none")}</span>
                    </div>
                  )}
                </section>

                <section className="grid gap-2 text-xs">
                  <Fact label="Applicant" value={String(row.applicant_full_name ?? "")} />
                  <Fact label="Role" value={String(row.applicant_role ?? "")} />
                  <Fact label="Phone" value={String(row.applicant_phone ?? "")} />
                  <Fact label="Business email" value={String(row.applicant_business_email ?? "")} />
                  <Fact label="Registration" value={String(row.commercial_registration_number ?? "")} />
                  <Fact label="Legal name" value={String(row.commercial_registration_legal_name ?? "")} />
                  <Fact label="Country" value={String(row.commercial_registration_country ?? "")} />
                  <Fact label="Expires" value={String(row.commercial_registration_expires_at ?? "")} />
                </section>

                <section className="text-xs">
                  <div className="font-medium">Documents</div>
                  <div className="mt-1 space-y-1">
                    {documents.map((doc) => (
                      <div key={String(doc.id)} className="rounded border p-2">
                        {String(doc.document_type)} · {String(doc.original_filename ?? doc.storage_path)} · {String(doc.status)}
                      </div>
                    ))}
                    {documents.length === 0 && <div className="text-muted-foreground">No active documents</div>}
                  </div>
                </section>

                <section className="text-xs">
                  <div className="font-medium">Document access</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {documents.map((doc) => (
                      <Button key={String(doc.id)} type="button" variant="outline" size="sm" onClick={() => openAsset("document", doc.id)}>
                        Open {String(doc.document_type)}
                      </Button>
                    ))}
                    {documents.length === 0 && <div className="text-muted-foreground">No active documents</div>}
                  </div>
                </section>

                <section className="text-xs">
                  <div className="font-medium">Images</div>
                  <div className="mt-1 space-y-1">
                    {images.map((image) => (
                      <div key={String(image.id)} className="rounded border p-2">
                        <div className="break-words">
                          {String(image.image_type)} · {String(image.original_filename ?? image.storage_path)} · {String(image.status)}
                        </div>
                        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => openAsset("image", image.id)}>
                          Open
                        </Button>
                      </div>
                    ))}
                    {images.length === 0 && <div className="text-muted-foreground">No pending onboarding images</div>}
                  </div>
                </section>

                <Textarea placeholder="Private admin notes" value={privateNotes} onChange={(e) => setPrivateNotes(e.target.value)} />
                <Textarea
                  placeholder="Applicant message"
                  value={applicantMessage}
                  onChange={(e) => setApplicantMessage(e.target.value)}
                />

                <div className="grid gap-2">
                  <Button disabled={!isReviewable || review.isPending} onClick={() => review.mutate("mark_under_review")}>
                    Mark under review
                  </Button>
                  <Button variant="outline" disabled={!isReviewable || review.isPending} onClick={() => review.mutate("changes_requested")}>
                    Request changes
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!isReviewable || review.isPending}
                    onClick={() => review.mutate("additional_documents_required")}
                  >
                    Request additional documents
                  </Button>
                  <Button variant="destructive" disabled={!isReviewable || review.isPending} onClick={() => review.mutate("reject")}>
                    Reject
                  </Button>
                  <Button disabled={!canApproveExisting || review.isPending} onClick={() => review.mutate("approve_existing")}>
                    Approve existing verification
                  </Button>
                  <Button disabled={!canApproveNewBusiness || review.isPending} onClick={() => review.mutate("approve_new_business")}>
                    Approve new business
                  </Button>
                </div>

                <section className="text-xs">
                  <div className="font-medium">History</div>
                  <div className="mt-1 space-y-1">
                    {events.slice(0, 8).map((event) => (
                      <div key={String(event.id)} className="text-muted-foreground">
                        {String(event.event_type)} · {new Date(String(event.created_at)).toLocaleString()}
                      </div>
                    ))}
                    {events.length === 0 && <div className="text-muted-foreground">No events</div>}
                  </div>
                </section>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No submission selected.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function businessName(row: Record<string, unknown>) {
  const names = (row.business_name_localized ?? {}) as Record<string, unknown>;
  return String(names.en ?? names.tr ?? names.ar ?? Object.values(names)[0] ?? row.target_business_id ?? row.id);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words">{value || "-"}</div>
    </div>
  );
}
