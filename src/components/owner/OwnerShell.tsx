import type { ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  Building2,
  ClipboardList,
  Bell,
  UserCheck,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "", label: "Dashboard", icon: Home },
  { to: "/claim", label: "Claim business", icon: UserCheck },
  { to: "/notifications", label: "Notifications", icon: Bell },
] as const;

export function OwnerShell({
  children,
  businessNav,
}: {
  children: ReactNode;
  businessNav?: ReactNode;
}) {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const base = `/${lang ?? "tr"}/owner`;
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[240px_1fr]">
        <aside className="rounded-xl border bg-card p-3">
          <div className="mb-3 flex items-center gap-2 px-2 py-1 text-sm font-semibold">
            <Building2 className="h-4 w-4" /> Owner portal
          </div>
          <nav className="flex flex-col gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={`${base}${n.to}` as string}
                activeOptions={{ exact: n.to === "" }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                activeProps={{ className: "bg-muted text-foreground" }}
              >
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            ))}
          </nav>
          {businessNav ? (
            <div className="mt-4 border-t pt-3">
              <div className="mb-1 flex items-center gap-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ClipboardList className="h-3.5 w-3.5" /> Business
              </div>
              {businessNav}
            </div>
          ) : null}
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
