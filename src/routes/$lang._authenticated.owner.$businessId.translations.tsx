import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOwnedBusiness, submitChangeRequest } from "@/lib/owner/owner.functions";
import { translationsSchema } from "@/lib/owner/field-allowlists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/translations")({
  ssr: false,
  component: TranslationsEditor,
});

const LANGS = ["tr", "en", "ar"] as const;
type Lang = (typeof LANGS)[number];
type Row = { language: Lang; name: string; description: string };

function TranslationsEditor() {
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
      const cur = biz.data.translations as { language: string; name: string | null; description: string | null }[];
      const idx = new Map(cur.map((t) => [t.language, t]));
      setRows(LANGS.map((l) => ({
        language: l,
        name: (idx.get(l)?.name as string) ?? (biz.data!.business.name as string) ?? "",
        description: (idx.get(l)?.description as string) ?? (biz.data!.business.description as string) ?? "",
      })));
    }
  }, [biz.data, rows]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!rows) throw new Error("Not ready");
      const parsed = translationsSchema.parse({ translations: rows });
      return submit({ data: { businessId, requestType: "translations", payload: parsed } });
    },
    onSuccess: () => {
      toast.success("Translations submitted for review");
      qc.invalidateQueries({ queryKey: ["owner:crs", businessId] });
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  if (!rows) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <form
      className="space-y-5 rounded-xl border bg-card p-5"
      onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
    >
      {rows.map((r, i) => (
        <div key={r.language} className="space-y-2 border-b pb-4 last:border-0">
          <div className="text-sm font-semibold uppercase">{r.language}</div>
          <div><Label>Name</Label><Input value={r.name} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></div>
          <div><Label>Description</Label><Textarea rows={3} value={r.description} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></div>
        </div>
      ))}
      <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Submitting…" : "Submit for review"}</Button>
    </form>
  );
}
