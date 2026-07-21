import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOwnedBusiness, submitChangeRequest } from "@/lib/owner/owner.functions";
import { attributesSchema } from "@/lib/owner/field-allowlists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/attributes")({
  ssr: false,
  component: AttributesEditor,
});

type Row = { key: string; value: string };

function AttributesEditor() {
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
      setRows((biz.data.attributes as { attribute_key: string; value: unknown }[]).map((a) => ({
        key: a.attribute_key, value: typeof a.value === "string" ? a.value : JSON.stringify(a.value ?? ""),
      })));
    }
  }, [biz.data, rows]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!rows) throw new Error("Not ready");
      const parsed = attributesSchema.parse({
        attributes: rows
          .filter((r) => r.key.trim())
          .map((r) => {
            let v: unknown = r.value;
            try { v = JSON.parse(r.value); } catch { /* keep string */ }
            return { key: r.key.trim(), value: v };
          }),
      });
      return submit({ data: { businessId, requestType: "attributes", payload: parsed } });
    },
    onSuccess: () => {
      toast.success("Attributes submitted for review");
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
      <p className="text-xs text-muted-foreground">Keys use <code>[a-z0-9_.-]</code>. Values can be plain text, numbers, or JSON.</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[220px_1fr_60px] gap-2">
          <Input placeholder="key.name" value={r.key} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
          <Input placeholder='value or JSON' value={r.value} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
          <Button type="button" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => setRows([...rows, { key: "", value: "" }])}>+ Add attribute</Button>
      <div><Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Submitting…" : "Submit for review"}</Button></div>
    </form>
  );
}
