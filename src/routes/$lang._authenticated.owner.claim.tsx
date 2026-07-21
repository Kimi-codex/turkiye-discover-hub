import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  submitOwnershipClaim,
  createClaimEvidenceUpload,
  listMyOwnershipClaims,
} from "@/lib/owner/owner.functions";
import { supabase } from "@/integrations/supabase/client";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/claim")({
  ssr: false,
  component: ClaimPage,
});

function ClaimPage() {
  const submit = useServerFn(submitOwnershipClaim);
  const createUpload = useServerFn(createClaimEvidenceUpload);
  const listClaims = useServerFn(listMyOwnershipClaims);
  const claims = useQuery({ queryKey: ["owner:my-claims"], queryFn: () => listClaims() });

  const [businessId, setBusinessId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [message, setMessage] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { path, uploadUrl } = await createUpload({
        data: { fileName: file.name, contentType: file.type || "application/octet-stream" },
      });
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      return path;
    },
    onSuccess: (path) => setEvidence((e) => [...e, path]),
    onError: (e) => toast.error(String(e)),
  });

  const send = useMutation({
    mutationFn: () =>
      submit({
        data: {
          businessId,
          fullName,
          phone: phone || undefined,
          businessEmail,
          evidenceUrls: evidence,
          message: message || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Claim submitted");
      setBusinessId(""); setFullName(""); setPhone(""); setBusinessEmail(""); setMessage("");
      setEvidence([]);
      claims.refetch();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Response ? `${e.status}` : String(e)),
  });

  return (
    <OwnerShell>
      <div className="max-w-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Claim ownership</h1>
          <p className="text-sm text-muted-foreground">
            Submit proof that you represent the business. An admin will review and, if approved,
            grant you the owner role.
          </p>
        </header>

        <form
          className="space-y-4 rounded-xl border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!businessId || !fullName || !businessEmail)
              return toast.error("Fill required fields");
            send.mutate();
          }}
        >
          <div>
            <Label>Business ID (UUID)</Label>
            <Input value={businessId} onChange={(e) => setBusinessId(e.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Your full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div>
              <Label>Business email</Label>
              <Input type="email" value={businessEmail} onChange={(e) => setBusinessEmail(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>Phone (optional)</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>Message (optional)</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Evidence (private — only admins can view)</Label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
            {evidence.length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground">
                {evidence.map((p) => (<li key={p}>✓ {p}</li>))}
              </ul>
            )}
          </div>
          <Button type="submit" disabled={send.isPending}>
            {send.isPending ? "Submitting…" : "Submit claim"}
          </Button>
        </form>

        {supabase && null}
      </div>
    </OwnerShell>
  );
}
