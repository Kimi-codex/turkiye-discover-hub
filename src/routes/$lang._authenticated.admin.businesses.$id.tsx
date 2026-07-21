import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBusinessAdmin, updateBusinessAdmin } from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/businesses/$id")({
  ssr: false,
  component: EditBusinessPage,
});

function EditBusinessPage() {
  const { lang, id } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "business", id],
    queryFn: () => getBusinessAdmin({ data: { id } }),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data?.business) {
      const b = q.data.business as Record<string, unknown>;
      setForm({
        name: String(b.name ?? ""),
        slug: String(b.slug ?? ""),
        description: String(b.description ?? ""),
        formatted_address: String(b.formatted_address ?? ""),
        phone: String(b.phone ?? ""),
        website: String(b.website ?? ""),
        latitude: b.latitude != null ? String(b.latitude) : "",
        longitude: b.longitude != null ? String(b.longitude) : "",
      });
    }
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      updateBusinessAdmin({
        data: {
          id,
          patch: {
            name: form.name,
            slug: form.slug,
            description: form.description || null,
            formatted_address: form.formatted_address || null,
            phone: form.phone || null,
            website: form.website || null,
            latitude: form.latitude ? Number(form.latitude) : null,
            longitude: form.longitude ? Number(form.longitude) : null,
          },
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["admin", "business", id] });
      qc.invalidateQueries({ queryKey: ["admin", "businesses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (q.error) return <div className="p-6 text-sm text-destructive">{(q.error as Error).message}</div>;
  const biz = q.data!.business as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit business</h1>
        <Button asChild variant="outline">
          <Link to="/$lang/_authenticated/admin/businesses" params={{ lang }}>
            Back
          </Link>
        </Button>
      </div>
      <div className="rounded-xl border bg-card p-4 text-xs">
        <div>
          <span className="text-muted-foreground">place_id: </span>
          <span className="font-mono">{String(biz.place_id ?? "—")}</span>
          <span className="ml-2 text-muted-foreground">(read-only)</span>
        </div>
      </div>
      <form
        className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        {[
          ["name", "Name"],
          ["slug", "Slug"],
          ["formatted_address", "Address"],
          ["phone", "Phone"],
          ["website", "Website"],
          ["latitude", "Latitude"],
          ["longitude", "Longitude"],
        ].map(([k, label]) => (
          <div key={k} className="grid gap-1">
            <Label htmlFor={k}>{label}</Label>
            <Input
              id={k}
              value={form[k] ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
            />
          </div>
        ))}
        <div className="md:col-span-2 grid gap-1">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={5}
            value={form.description ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" disabled={mut.isPending}>
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>

      <details className="rounded-xl border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Raw data</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(biz.raw_data ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}
