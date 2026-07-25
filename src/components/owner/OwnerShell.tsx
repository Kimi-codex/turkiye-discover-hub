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
import { useT, type MessageKey } from "@/lib/i18n";

const memberNav = [
  { to: "", label: "owner.nav.dashboard", icon: Home },
  { to: "/onboarding", label: "owner.nav.onboarding", icon: UserCheck },
  { to: "/notifications", label: "owner.nav.notifications", icon: Bell },
] as const;

const applicantNav = [
  { to: "/onboarding", label: "owner.nav.onboarding", icon: UserCheck },
] as const;

export function OwnerShell({
  children,
  businessNav,
  variant = "member",
}: {
  children: ReactNode;
  businessNav?: ReactNode;
  variant?: "member" | "applicant";
}) {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const t = useT();
  const base = `/${lang ?? "tr"}/owner`;
  const nav = variant === "applicant" ? applicantNav : memberNav;
  const headingKey = variant === "applicant" ? "owner.applicant_portal" : "owner.portal";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[240px_1fr]">
        <aside className="rounded-xl border bg-card p-3">
          <div className="mb-3 flex items-center gap-2 px-2 py-1 text-sm font-semibold">
            <Building2 className="h-4 w-4" /> {t(headingKey as MessageKey)}
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
                <n.icon className="h-4 w-4" /> {t(n.label as MessageKey)}
              </Link>
            ))}
          </nav>
          {businessNav ? (
            <div className="mt-4 border-t pt-3">
              <div className="mb-1 flex items-center gap-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ClipboardList className="h-3.5 w-3.5" /> {t("owner.nav.business")}
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
