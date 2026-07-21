import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getOwnedBusiness,
  submitChangeRequest,
} from "@/lib/owner/owner.functions";
import { businessFieldsSchema } from "@/lib/owner/field-allowlists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/profile")({
  ssr: false,
  component: ProfileEditor,
});

type Fields = {
  name: string; description: string; phone: string; international_phone: string;
  email: string; website: string; formatted_address: string; neighborhood: string;
  price_level: string;
};

function ProfileEditor() {
  const { businessId } = useParams({ strict: false }) as { businessId: string };
  const qc = useQueryClient();
  const fetchBiz = useServerFn(getOwnedBusiness);
  const submit = useServerFn(submitChangeRequest);
  const biz = useQuery({
    queryKey: ["owner:biz", businessId],
    queryFn: () => fetchBiz({ data: { businessId } }),
  });
  const [f, setF] = useState<Fields | null>(null);
  useEffect(() => {
    if (biz.data && !f) {
      const b = biz.data.business as Record<string, unknown>;
      setF({
        name: (b.name as string) ?? "",
        description: (b.description as string) ?? "",
        phone: (b.phone as string) ?? "",
        international_phone: (b.international_phone as string) ?? "",
        email: (b.email as string) ?? "",
        website: (b.website as string) ?? "",
        formatted_address: (b.formatted_address as string) ?? "",
        neighborhood: (b.neighborhood as string) ?? "",
        price_level: b.price_level == null ? "" : String(b.price_level),
      });
    }
  }, [biz.data, f]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!f) throw new Error("Not ready");
      const payload: Record<string, unknown> = {};
      const orig = biz.data!.business as Record<string, unknown>;
      const keys: (keyof Fields)[] = [
        "name","description","phone","international_phone","email","website",
        "formatted_address","neighborhood",
      ];
      for (const k of keys) {
        const v = f[k].trim();
        const cur = (orig[k] as string) ?? "";
        if (v !== cur) payload[k] = v === "" ? null : v;
      }
      const pl = f.price_level === "" ? null : Number(f.price_level);
      if (pl !== orig.price_level) payload.price_level = pl;
      if (Object.keys(payload).length === 0) throw new Error("No changes");
      const parsed = businessFieldsSchema.parse(payload);
      return submit({
        data: { businessId, requestType: "business_fields", payload: parsed },
      });
    },
    onSuccess: () => {
      toast.success("Change request submitted for review");
      qc.invalidateQueries({ queryKey: ["owner:crs", businessId] });
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  if (!f) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const bind = (k: keyof Fields) => ({
    value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }),
  });

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-5"
      onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
    >
      <p className="text-sm text-muted-foreground">
        Changes are submitted as a request. An admin must approve them before they go live.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Name</Label><Input {...bind("name")} /></div>
        <div><Label>Neighborhood</Label><Input {...bind("neighborhood")} /></div>
        <div className="sm:col-span-2"><Label>Description</Label><Textarea rows={4} {...bind("description")} /></div>
        <div><Label>Phone</Label><Input {...bind("phone")} /></div>
        <div><Label>International phone</Label><Input {...bind("international_phone")} /></div>
        <div><Label>Email</Label><Input type="email" {...bind("email")} /></div>
        <div><Label>Website</Label><Input {...bind("website")} /></div>
        <div className="sm:col-span-2"><Label>Formatted address</Label><Input {...bind("formatted_address")} /></div>
        <div>
          <Label>Price level (0–4)</Label>
          <Input inputMode="numeric" {...bind("price_level")} />
        </div>
      </div>
      <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Submitting…" : "Submit for review"}</Button>
    </form>
  );
}
