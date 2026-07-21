import { useState } from "react";
import { LogOut, User as UserIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { LocaleLink } from "./LocaleLink";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SmartSearchInput } from "@/components/search/SmartSearchInput";
import { useLocale, useT, localePath } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { HiTurkiyeLogo } from "./HiTurkiyeLogo";

interface PublicHeaderProps {
  variant?: "transparent" | "solid";
  showCompactSearch?: boolean;
  initialSearchValue?: string;
}

async function fetchUserRoles(userId: string | undefined): Promise<string[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) return [];
  return (data ?? []).map((r) => r.role as string);
}

export function PublicHeader({
  variant = "solid",
  showCompactSearch = false,
  initialSearchValue = "",
}: PublicHeaderProps) {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const { data: roles = [] } = useQuery({
    queryKey: ["user-roles", user?.id ?? "guest"],
    queryFn: () => fetchUserRoles(user?.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const isAdmin = roles.includes("admin");
  const isOwner = roles.includes("business_owner");

  const transparent = variant === "transparent";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      navigate({ to: localePath(locale, "/auth"), replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-colors",
        transparent
          ? "bg-transparent"
          : "border-b border-black/5 bg-background/95 backdrop-blur",
      )}
    >
      <div className="mx-auto grid h-16 w-full max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-6 lg:h-18">
        <LocaleLink
          to="/"
          className="flex shrink-0 items-center gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          aria-label={t("home.badge")}
        >
          <HiTurkiyeLogo className="h-8 w-auto" />
        </LocaleLink>

        <div className="min-w-0">
          {showCompactSearch && !transparent && (
            <div className="mx-auto w-full max-w-xl">
              <SmartSearchInput
                size="compact"
                initialValue={initialSearchValue}
                placeholder={t("header.compact_placeholder")}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher variant="inline" />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  aria-label={t("header.account")}
                >
                  <UserIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="ms-1 hidden text-xs font-medium sm:inline">
                    {user.email?.split("@")[0] ?? t("header.account")}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuItem asChild>
                  <LocaleLink to="/account">{t("header.account")}</LocaleLink>
                </DropdownMenuItem>
                {isOwner && (
                  <DropdownMenuItem asChild>
                    <LocaleLink to="/owner">{t("owner.portal")}</LocaleLink>
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <LocaleLink to="/admin">{t("header.admin")}</LocaleLink>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
                  {t("auth.signout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <LocaleLink
              to="/auth"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors sm:text-sm",
                transparent
                  ? "border-white/60 bg-white/10 text-white backdrop-blur hover:bg-white/20"
                  : "border-primary/20 bg-primary text-primary-foreground hover:bg-primary-hover",
              )}
            >
              {t("nav.signin")}
            </LocaleLink>
          )}
        </div>
      </div>
    </header>
  );
}
