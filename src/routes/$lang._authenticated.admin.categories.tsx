import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listCategoriesAdmin } from "@/lib/admin/domain.functions";

export const Route = createFileRoute("/$lang/_authenticated/admin/categories")({
  ssr: false,
  component: CategoriesPage,
});

function CategoriesPage() {
  const q = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => listCategoriesAdmin(),
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Categories</h1>
      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">Parent</th>
                <th className="px-3 py-2">Translations</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Sort</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: Record<string, unknown>) => (
                <tr key={String(c.id)} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{String(c.slug)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{String(c.parent_id ?? "—")}</td>
                  <td className="px-3 py-2 text-xs">
                    {((c.category_translations as Array<{ language_code: string; name: string }>) ?? [])
                      .map((t) => `${t.language_code}: ${t.name}`)
                      .join(" · ")}
                  </td>
                  <td className="px-3 py-2">{c.is_active ? "✓" : "—"}</td>
                  <td className="px-3 py-2">{String(c.sort_order ?? 0)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>
                    No categories
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Category CRUD forms will be enabled in the next admin iteration; use the SQL migration
        seeds for now.
      </p>
    </div>
  );
}
