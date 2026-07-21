import { Outlet, createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOwnedBusiness } from "@/lib/owner/owner.functions";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$lang/_authenticated/owner/$businessId")({
  ssr: false,
  component: OwnedBusinessLayout,
});

const tabs = [
  { to: "", label: "Overview" },
  { to: "/profile", label: "Profile" },
  { to: "/hours", label: "Hours" },
  { to: "/services", label: "Services" },
  { to: "/attributes", label: "Attributes" },
  { to: "/translations", label: "Translations" },
  { to: "/images", label: "Images" },
  { to: "/reviews", label: "Reviews" },
];

function OwnedBusinessLayout() {
  const { lang, businessId } = useParams({ strict: false }) as {
    lang: string; businessId: string;
  };
  const fetchBiz = useServerFn(getOwnedBusiness);
  const q = useQuery({
    queryKey: ["owner:biz", businessId],
    queryFn: () => fetchBiz({ data: { businessId } }),
  });
  const base = `/${lang}/owner/${businessId}`;

  return (
    <OwnerShell
      businessNav={
        <nav className="flex flex-col gap-0.5">
          {tabs.map((t) => (
            <Link
              key={t.to}
              to={`${base}${t.to}` as string}
              activeOptions={{ exact: t.to === "" }}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              activeProps={{ className: "bg-muted text-foreground" }}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      }
    >
      <div className="space-y-6">
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : q.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
            {q.error instanceof Response
              ? q.error.status === 403
                ? "You are not the owner of this business."
                : `Error ${q.error.status}`
              : String(q.error)}
          </div>
        ) : (
          <>
            <header>
              <h1 className="text-2xl font-semibold">{q.data?.business.name}</h1>
              <p className="text-sm text-muted-foreground">/{q.data?.business.slug}</p>
            </header>
            <Outlet />
          </>
        )}
      </div>
    </OwnerShell>
  );
}
