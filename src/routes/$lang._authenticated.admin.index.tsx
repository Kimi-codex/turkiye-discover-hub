import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getAdminOverview } from "@/lib/admin/admin.functions";
import { Card } from "@/components/ui/card";

const overviewQuery = queryOptions({
  queryKey: ["admin", "overview"],
  queryFn: () => getAdminOverview(),
});

export const Route = createFileRoute("/$lang/_authenticated/admin/")({
  ssr: false,
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  component: AdminDashboard,
  errorComponent: AdminDashboardError,
});

function AdminDashboardError({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="p-6 text-sm text-destructive">
      Failed to load dashboard: {(error as Error).message}
      <button
        className="ml-2 underline"
        onClick={() => {
          reset();
          router.invalidate();
        }}
      >
        Retry
      </button>
    </div>
  );
}

function AdminDashboard() {
  const { data } = useSuspenseQuery(overviewQuery);
  const items: Array<[string, number]> = [
    ["Businesses", data.businesses],
    ["Reviews", data.reviews],
    ["Reports", data.reports],
    ["Ownership claims", data.ownership_claims],
    ["Categories", data.categories],
    ["Cities", data.cities],
    ["Import batches", data.import_batches],
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
