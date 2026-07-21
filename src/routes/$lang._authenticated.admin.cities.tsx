import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listCitiesAdmin } from "@/lib/admin/domain.functions";

export const Route = createFileRoute("/$lang/_authenticated/admin/cities")({
  ssr: false,
  component: CitiesPage,
});

function CitiesPage() {
  const q = useQuery({
    queryKey: ["admin", "cities"],
    queryFn: () => listCitiesAdmin(),
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cities</h1>
      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">Translations</th>
                <th className="px-3 py-2">Coords</th>
                <th className="px-3 py-2">Featured</th>
                <th className="px-3 py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: Record<string, unknown>) => (
                <tr key={String(c.id)} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{String(c.slug)}</td>
                  <td className="px-3 py-2 text-xs">
                    {((c.city_translations as Array<{ language_code: string; name: string }>) ?? [])
                      .map((t) => `${t.language_code}: ${t.name}`)
                      .join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.latitude != null && c.longitude != null
                      ? `${Number(c.latitude).toFixed(3)}, ${Number(c.longitude).toFixed(3)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{c.is_featured ? "★" : "—"}</td>
                  <td className="px-3 py-2">{c.is_active ? "✓" : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No cities
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        City & district CRUD forms will land in the next iteration; seeds are managed via SQL.
      </p>
    </div>
  );
}
