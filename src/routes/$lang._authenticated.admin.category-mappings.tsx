import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  validateSearch: (s: Record<string, unknown>): { returnTo?: string; batchId?: string } => {
    const returnTo = typeof s.returnTo === "string" && s.returnTo.startsWith("/") ? s.returnTo : undefined;
    const batchId = typeof s.batchId === "string" && s.batchId.length > 0 ? s.batchId : undefined;
    return { returnTo, batchId };
  },
  component: MappingsPage,
});

function MappingsPage() {
  const { lang } = Route.useParams();
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");

  const cats = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => listCategoriesAdmin(),
  });
  const q = useQuery({
    queryKey: ["admin", "mappings", status, search.batchId ?? null],
    queryFn: () => listCategoryMappingsAdmin({ data: { status, batchId: search.batchId } }),
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
      setBulkCategoryId("");
      qc.invalidateQueries({ queryKey: ["admin", "mappings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = ((q.data as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? []) as Array<
    Record<string, unknown>
  >;
  const visibleIds: string[] = rows.map((r) => String(r.id));
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));
  const selectedIds: string[] = Array.from(checked);
  const batchScoped = Boolean((q.data as { batchScoped?: boolean } | undefined)?.batchScoped);
  const labelCount = (q.data as { labelCount?: number | null } | undefined)?.labelCount ?? null;
  const applyBulkCategory = () => {
    if (!bulkCategoryId) return;
    setSelection((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => {
        next[id] = bulkCategoryId;
      });
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Category mappings</h1>
          <p className="text-xs text-muted-foreground">
            {batchScoped
              ? "Showing only the category labels discovered in this import batch."
              : "Map source labels to catalog categories, then return to the import batch and continue validation."}
          </p>
          {batchScoped && (
            <p className="mt-1 text-xs text-muted-foreground">
              Batch filter active · {labelCount ?? 0} discovered label{labelCount === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {search.returnTo && (
            <Button asChild size="sm" variant="outline">
              <Link to={search.returnTo}>Return to import batch</Link>
            </Button>
          )}
          {search.batchId && (
            <Button asChild size="sm" variant="outline">
              <Link to="/$lang/admin/category-mappings" params={{ lang }} search={{ returnTo: search.returnTo }}>
                Show global queue
              </Link>
            </Button>
          )}
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as (typeof STATUSES)[number]);
              setChecked(new Set());
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      {batchScoped && labelCount === 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          No category labels have been extracted for this batch yet. Return to the import batch, run analysis, then come back here.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm">
          <span className="font-medium">
            {checked.size} selected · {visibleIds.length} visible · {status}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={visibleIds.length === 0 || allVisibleChecked}
            onClick={() => setChecked(new Set(visibleIds))}
          >
            Select all visible
          </Button>
          <Button size="sm" variant="ghost" disabled={checked.size === 0} onClick={() => setChecked(new Set())}>
            Clear selection
          </Button>
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
          >
            <option value="">Choose category for selected…</option>
            {catOptions.map((o: { id: string; label: string }) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={!bulkCategoryId} onClick={applyBulkCategory}>
            Apply category to selected
          </Button>
          <Button
            size="sm"
            disabled={checked.size === 0 || !bulkCategoryId || mut.isPending}
            title={!bulkCategoryId ? "Choose a category before approving selected rows." : undefined}
            onClick={() => mut.mutate({ ids: selectedIds, status: "approved", categoryId: bulkCategoryId })}
          >
            Approve selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={checked.size === 0 || mut.isPending}
            onClick={() => mut.mutate({ ids: selectedIds, status: "ignored" })}
          >
            Ignore selected
          </Button>
          {checked.size > 0 && !bulkCategoryId && (
            <span className="text-xs text-muted-foreground">Choose a category before approving; or use Ignore selected.</span>
          )}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible mappings"
                  checked={allVisibleChecked}
                  onChange={(e) => {
                    if (e.target.checked) setChecked(new Set(visibleIds));
                    else setChecked(new Set());
                  }}
                />
              </th>
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
                      {catOptions.map((o: { id: string; label: string }) => (
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
                  {q.isLoading
                    ? "Loading mappings…"
                    : batchScoped
                      ? status === "pending"
                        ? "No pending labels for this batch. Return to the import batch and continue."
                        : `No ${status} labels for this batch.`
                      : "Nothing to review"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
