import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listCategoriesAdmin,
  listCategoryMappingsAdmin,
  setCategoryMappingAdmin,
} from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const STATUSES = ["pending", "approved", "ignored"] as const;

export const Route = createFileRoute("/$lang/_authenticated/admin/category-mappings")({
  ssr: false,
  component: MappingsPage,
});

function MappingsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const cats = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => listCategoriesAdmin(),
  });
  const q = useQuery({
    queryKey: ["admin", "mappings", status],
    queryFn: () => listCategoryMappingsAdmin({ data: { status } }),
  });

  const catOptions = useMemo(
    () =>
      (cats.data?.rows ?? []).map((c: Record<string, unknown>) => ({
        id: String(c.id),
        label:
          ((c.category_translations as Array<{ language_code: string; name: string }>) ?? []).find(
            (t) => t.language_code === "en",
          )?.name ?? String(c.slug),
      })),
    [cats.data],
  );

  const mut = useMutation({
    mutationFn: (v: { ids: string[]; status: (typeof STATUSES)[number]; categoryId?: string | null }) =>
      setCategoryMappingAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      setChecked(new Set());
      qc.invalidateQueries({ queryKey: ["admin", "mappings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Category mappings</h1>
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {checked.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm">
          <span>{checked.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => mut.mutate({ ids: Array.from(checked), status: "ignored" })}
          >
            Ignore
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2">Source label</th>
              <th className="px-3 py-2">Usage</th>
              <th className="px-3 py-2">Map to category</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: Record<string, unknown>) => {
              const id = String(r.id);
              return (
                <tr key={id} className="border-t">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked.has(id)}
                      onChange={(e) => {
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{String(r.source_category)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{String(r.usage_count ?? 0)}</td>
                  <td className="px-3 py-2">
                    <select
                      className="rounded-md border bg-background px-2 py-1 text-xs"
                      value={selection[id] ?? (r.category_id as string | undefined) ?? ""}
                      onChange={(e) => setSelection((s) => ({ ...s, [id]: e.target.value }))}
                    >
                      <option value="">Select…</option>
                      {catOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        disabled={!(selection[id] ?? r.category_id)}
                        onClick={() =>
                          mut.mutate({
                            ids: [id],
                            status: "approved",
                            categoryId: (selection[id] ?? (r.category_id as string)) || null,
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => mut.mutate({ ids: [id], status: "ignored" })}
                      >
                        Ignore
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Nothing to review
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
