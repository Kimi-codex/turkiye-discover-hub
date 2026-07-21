import type { ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { LayoutDashboard, Users, Building2, Upload, Flag, Shield, Tags, MapPin, Star, FileCheck, ScrollText, Settings, GitBranch, Image as ImageIcon, ClipboardList, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "", label: "Dashboard", icon: LayoutDashboard },
  { to: "/businesses", label: "Businesses", icon: Building2 },
  { to: "/change-requests", label: "Change Requests", icon: ClipboardList },
  { to: "/reply-moderation", label: "Reply Moderation", icon: MessageSquare },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/category-mappings", label: "Category Mappings", icon: GitBranch },
  { to: "/cities", label: "Cities", icon: MapPin },
  { to: "/reviews", label: "Reviews", icon: Star },
  { to: "/reports", label: "Reports", icon: Flag },
  { to: "/ownership-claims", label: "Ownership Claims", icon: FileCheck },
  { to: "/imports", label: "Imports", icon: Upload },
  { to: "/images", label: "Images", icon: ImageIcon },
  { to: "/users", label: "Users", icon: Users },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const base = `/${lang ?? "tr"}/admin`;
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-7xl grid-cols-[220px_1fr] gap-6 px-4 py-6">
        <aside className="rounded-xl border bg-card p-3">
          <div className="mb-3 flex items-center gap-2 px-2 py-1 text-sm font-semibold">
            <Shield className="h-4 w-4" /> Admin
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
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
