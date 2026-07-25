import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, CircleAlert, Loader2, UserRound } from "lucide-react";
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
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<Locale>(locale);

  useEffect(() => {
    if (user?.user_metadata) {
      setName(user.user_metadata.full_name ?? "");
      setPhone(user.user_metadata.phone ?? "");
      setLanguage((user.user_metadata.preferred_language as Locale) ?? locale);
    }
  }, [user, locale]);

  const saveMutation = useMutation({
    mutationFn: async (data: { full_name: string; phone: string; preferred_language: Locale }) => {
      const { error } = await supabase.auth.updateUser({ data });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("account.settings.saved"));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("account.settings.error"));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ full_name: name, phone, preferred_language: language });
  };

  const emailVerified = user?.email_confirmed_at || user?.confirmed_at;
  const hasChanges =
    name !== (user?.user_metadata?.full_name ?? "") ||
    phone !== (user?.user_metadata?.phone ?? "") ||
    language !== (user?.user_metadata?.preferred_language ?? locale);

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
