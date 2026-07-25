import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, CircleAlert, Loader2, Lock, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useT, useLocaleContext, LOCALES, type Locale } from "@/lib/i18n";
import { LocaleLink } from "@/components/site/LocaleLink";

export const Route = createFileRoute("/$lang/_authenticated/account/settings")({
  head: () => ({
    meta: [{ title: "Profil Ayarları · TurkeyDirect" }, { name: "robots", content: "noindex" }],
  }),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const { user } = useAuth();
  const t = useT();
  const { locale } = useLocaleContext();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<Locale>(locale);
  const [initial, setInitial] = useState<{ name: string; phone: string; language: Locale } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.user_metadata) {
      const n = user.user_metadata.full_name ?? "";
      const p = user.user_metadata.phone ?? "";
      const l = (user.user_metadata.preferred_language as Locale) ?? locale;
      setName(n);
      setPhone(p);
      setLanguage(l);
      setInitial({ name: n, phone: p, language: l });
    }
  }, [user, locale]);

  const saveMutation = useMutation({
    mutationFn: async (data: { full_name: string; phone: string; preferred_language: Locale }) => {
      if (!user?.id) throw new Error("Not authenticated");
      // 1. Persist to public.profiles so useAccountState (and the rest of the
      //    app) reads the fresh values.
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          full_name: data.full_name,
          phone: data.phone,
          preferred_language: data.preferred_language,
        })
        .eq("id", user.id);
      if (profileErr) throw profileErr;
      // 2. Mirror to auth.user_metadata so `user` object stays in sync.
      const { error: authErr } = await supabase.auth.updateUser({ data });
      if (authErr) throw authErr;
    },
    onSuccess: () => {
      toast.success(t("account.settings.saved"));
      setInitial({ name, phone, language });
      qc.invalidateQueries({ queryKey: ["account:profile"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("account.settings.error"));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ full_name: name, phone, preferred_language: language });
  };

  const changePasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("account.settings.password_changed"));
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("account.settings.error"));
    },
  });

  function handleChangePassword() {
    setPasswordError(null);
    if (!newPassword || newPassword.length < 8) {
      setPasswordError(t("auth.password_too_short"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("account.settings.password_mismatch"));
      return;
    }
    changePasswordMutation.mutate(newPassword);
  }

  const emailVerified = user?.email_confirmed_at || user?.confirmed_at;
  const hasChanges = initial
    ? name !== initial.name || phone !== initial.phone || language !== initial.language
    : false;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <LocaleLink to="/account">
            <ArrowLeft className="mr-1 h-4 w-4" /> {t("account.settings.back")}
          </LocaleLink>
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5" />
              <CardTitle>{t("account.settings.title")}</CardTitle>
            </div>
            <CardDescription>{t("account.settings.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="settings-name">{t("auth.full_name")}</Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-phone">{t("auth.phone")}</Label>
              <Input
                id="settings-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-lang">{t("account.settings.preferred_language")}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as Locale)}>
                <SelectTrigger id="settings-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`lang.${l}` as any)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("account.settings.email_section")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>{t("auth.email")}</Label>
              <Input value={user?.email ?? ""} disabled readOnly />
            </div>

            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
              {emailVerified ? (
                <>
                  <BadgeCheck className="h-4 w-4 text-green-600" />
                  <span className="text-green-700">{t("account.settings.verified")}</span>
                </>
              ) : (
                <>
                  <CircleAlert className="h-4 w-4 text-amber-600" />
                  <span className="text-amber-700">{t("account.settings.not_verified")}</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              <CardTitle>{t("account.settings.change_password_title")}</CardTitle>
            </div>
            <CardDescription>{t("account.settings.change_password_description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="settings-new-password">{t("account.settings.new_password")}</Label>
              <Input
                id="settings-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-confirm-password">{t("account.settings.confirm_password")}</Label>
              <Input
                id="settings-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {passwordError && (
              <p className="text-sm text-destructive">{passwordError}</p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleChangePassword}
              disabled={changePasswordMutation.isPending}
            >
              {changePasswordMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("common.loading")}
                </span>
              ) : (
                t("account.settings.change_password_title")
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={!hasChanges || saveMutation.isPending}>
            {saveMutation.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </span>
            ) : (
              t("account.settings.save")
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
