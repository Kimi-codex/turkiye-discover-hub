import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listBusinessesAdmin,
  setBusinessStatusAdmin,
  setBusinessFlagAdmin,
  deleteBusinessAdmin,
} from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

const STATUSES = ["draft", "pending_review", "published", "hidden", "rejected"] as const;

export const Route = createFileRoute("/$lang/_authenticated/admin/businesses")({
  ssr: false,
  component: BusinessesPage,
});

function BusinessesPage() {
  const { lang } = Route.useParams();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [sort, setSort] = useState<"recent" | "name" | "rating">("recent");

  const q = useQuery({
    queryKey: ["admin", "businesses", { page, search, status, sort }],
    queryFn: () => listBusinessesAdmin({ data: { page, perPage: 25, search, status: status || undefined, sort } }),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: (typeof STATUSES)[number] }) =>
      setBusinessStatusAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["admin", "businesses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const flagMut = useMutation({
    mutationFn: (v: { id: string; flag: "is_featured" | "is_verified"; value: boolean }) =>
      setBusinessFlagAdmin({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "businesses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (v: { id: string; confirmSlug: string }) => deleteBusinessAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin", "businesses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Businesses <span className="text-sm font-normal text-muted-foreground">({total})</span></h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Input
          className="max-w-sm"
          placeholder="Search name, slug, place_id…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <select
          className="rounded-md border bg-background px-2 py-2 text-sm"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border bg-background px-2 py-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="recent">Sort: recent</option>
          <option value="name">Sort: name</option>
          <option value="rating">Sort: rating</option>
        </select>
      </div>
      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Rating</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Flags</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b: any) => (
                <tr key={b.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{b.slug}</div>
                    {b.place_id && (
                      <a
                        className="text-xs text-primary underline inline-flex items-center gap-1"
                        href={`https://www.google.com/maps/place/?q=place_id:${b.place_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Google <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="rounded-md border bg-background px-2 py-1 text-xs"
                      value={b.status}
                      disabled={statusMut.isPending}
                      onChange={(e) =>
                        statusMut.mutate({ id: b.id, status: e.target.value as (typeof STATUSES)[number] })
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {b.rating ? `★ ${Number(b.rating).toFixed(1)}` : "—"}
                    <span className="ml-1 text-xs text-muted-foreground">({b.review_count ?? 0})</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{b.source ?? "manual"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        className="text-left"
                        disabled={flagMut.isPending}
                        onClick={() => flagMut.mutate({ id: b.id, flag: "is_featured", value: !b.is_featured })}
                      >
                        <Badge variant={b.is_featured ? "default" : "outline"}>
                          {b.is_featured ? "Featured" : "Not featured"}
                        </Badge>
                      </button>
                      <button
                        className="text-left"
                        disabled={flagMut.isPending}
                        onClick={() => flagMut.mutate({ id: b.id, flag: "is_verified", value: !b.is_verified })}
                      >
                        <Badge variant={b.is_verified ? "default" : "outline"}>
                          {b.is_verified ? "Verified" : "Unverified"}
                        </Badge>
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/$lang/place/$slug" params={{ lang, slug: b.slug }}>
                          View
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to="/$lang/_authenticated/admin/businesses/$id"
                          params={{ lang, id: b.id }}
                        >
                          Edit
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={delMut.isPending}
                        onClick={() => {
                          const c = window.prompt(
                            `Type slug "${b.slug}" to confirm delete:`,
                          );
                          if (c) delMut.mutate({ id: b.id, confirmSlug: c });
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                    No businesses
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">
          Page {page} of {totalPages}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
