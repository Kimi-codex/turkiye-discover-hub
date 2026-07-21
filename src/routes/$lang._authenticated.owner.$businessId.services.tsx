import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOwnedBusiness, submitChangeRequest } from "@/lib/owner/owner.functions";
import { servicesSchema } from "@/lib/owner/field-allowlists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/services")({
  ssr: false,
  component: ServicesEditor,
});

type Row = { name: string; description: string; price: string };

function ServicesEditor() {
  const { businessId } = useParams({ strict: false }) as { businessId: string };
  const qc = useQueryClient();
  const fetchBiz = useServerFn(getOwnedBusiness);
  const submit = useServerFn(submitChangeRequest);
  const biz = useQuery({
    queryKey: ["owner:biz", businessId],
    queryFn: () => fetchBiz({ data: { businessId } }),
  });
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (biz.data && !rows) {
      setRows((biz.data.services as { name: string; description: string | null; price: number | null }[]).map((s) => ({
        name: s.name ?? "", description: s.description ?? "", price: s.price == null ? "" : String(s.price),
      })));
    }
  }, [biz.data, rows]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!rows) throw new Error("Not ready");
      const cleaned = rows
        .map((r) => ({
          name: r.name.trim(),
          description: r.description.trim() || null,
          price: r.price === "" ? null : Number(r.price),
        }))
        .filter((r) => r.name);
      const payload = servicesSchema.parse({ services: cleaned });
      return submit({ data: { businessId, requestType: "services", payload } });
    },
    onSuccess: () => {
      toast.success("Services submitted for review");
      qc.invalidateQueries({ queryKey: ["owner:crs", businessId] });
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  if (!rows) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-5"
      onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
    >
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_120px_60px] gap-2">
          <Input placeholder="Name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
          <Input placeholder="Description" value={r.description} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
          <Input placeholder="Price" inputMode="decimal" value={r.price} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
          <Button type="button" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => setRows([...rows, { name: "", description: "", price: "" }])}>
        + Add service
      </Button>
      <div><Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Submitting…" : "Submit for review"}</Button></div>
    </form>
  );
}
