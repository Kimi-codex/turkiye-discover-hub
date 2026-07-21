import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOwnedBusiness, submitChangeRequest } from "@/lib/owner/owner.functions";
import { openingHoursSchema } from "@/lib/owner/field-allowlists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId/hours")({
  ssr: false,
  component: HoursEditor,
});

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

type Row = { day_of_week: number; open_time: string | null; close_time: string | null; is_closed: boolean };

function HoursEditor() {
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
      const cur = biz.data.hours as Row[];
      const idx = new Map(cur.map((r) => [r.day_of_week, r]));
      setRows(
        Array.from({ length: 7 }, (_, i) => {
          const r = idx.get(i);
          return r ?? { day_of_week: i, open_time: "09:00", close_time: "18:00", is_closed: false };
        }),
      );
    }
  }, [biz.data, rows]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!rows) throw new Error("Not ready");
      const payload = openingHoursSchema.parse({ hours: rows });
      return submit({ data: { businessId, requestType: "opening_hours", payload } });
    },
    onSuccess: () => {
      toast.success("Hours submitted for review");
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
      <p className="text-sm text-muted-foreground">Times use 24h HH:MM format.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[60px_1fr_1fr_100px] items-center gap-2">
            <div className="text-sm font-medium">{DAYS[i]}</div>
            <Input
              placeholder="09:00" value={r.open_time ?? ""} disabled={r.is_closed}
              onChange={(e) => {
                const v = e.target.value || null;
                setRows(rows.map((x, j) => (j === i ? { ...x, open_time: v } : x)));
              }}
            />
            <Input
              placeholder="18:00" value={r.close_time ?? ""} disabled={r.is_closed}
              onChange={(e) => {
                const v = e.target.value || null;
                setRows(rows.map((x, j) => (j === i ? { ...x, close_time: v } : x)));
              }}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={r.is_closed}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, is_closed: e.target.checked } : x)))
                }
              />
              Closed
            </label>
          </div>
        ))}
      </div>
      <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Submitting…" : "Submit for review"}</Button>
    </form>
  );
}
