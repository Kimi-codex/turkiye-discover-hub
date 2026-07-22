import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/use-auth";
import { useT, useLocaleContext } from "@/lib/i18n";

export const Route = createFileRoute("/$lang/auth")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const t = useT();
  const { locale } = useLocaleContext();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [registrationIntent, setRegistrationIntent] = useState<"explore" | "business">("explore");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: `/${locale}/account`, replace: true });
  }, [user, loading, navigate, locale]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t("auth.signed_in"));
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error(t("auth.password_too_short"));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("auth.password_mismatch"));
      return;
    }
    if (!termsAccepted) {
      toast.error(t("auth.terms_required"));
      return;
    }
    setBusy(true);
    const termsAcceptedAt = new Date().toISOString();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          registrationIntent === "business"
            ? `${window.location.origin}/${locale}/owner/onboarding`
            : `${window.location.origin}/${locale}/account`,
        data: {
          full_name: name,
          phone,
          preferred_language: locale,
          registration_intent: registrationIntent,
          terms_accepted_at: termsAcceptedAt,
          terms_version: "2026-07-22",
        },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    // Generic message: never expose whether admin was granted.
    toast.success(t("auth.check_email"));
  }

  async function handleGoogle() {
    setBusy(true);
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (res.error) {
      setBusy(false);
      toast.error(res.error.message ?? t("auth.google_failed"));
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">{t("auth.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.subtitle")}</p>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={handleGoogle}
        disabled={busy}
        className="w-full"
      >
        {t("auth.continue_google")}
      </Button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t("auth.or")}
        <div className="h-px flex-1 bg-border" />
      </div>

      <Tabs defaultValue="signin">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="signin">{t("auth.signin")}</TabsTrigger>
          <TabsTrigger value="signup">{t("auth.signup")}</TabsTrigger>
        </TabsList>
        <TabsContent value="signin" className="mt-4">
          <form onSubmit={handleSignIn} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="in-email">{t("auth.email")}</Label>
              <Input
                id="in-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="in-pass">{t("auth.password")}</Label>
              <Input
                id="in-pass"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" disabled={busy}>
              {t("auth.signin")}
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="signup" className="mt-4">
          <form onSubmit={handleSignUp} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="up-name">{t("auth.full_name")}</Label>
              <Input id="up-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="up-phone">{t("auth.phone")}</Label>
              <Input
                id="up-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="up-email">{t("auth.email")}</Label>
              <Input
                id="up-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="up-pass">{t("auth.password")}</Label>
              <Input
                id="up-pass"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                aria-describedby="up-pass-hint"
              />
              <p id="up-pass-hint" className="text-xs text-muted-foreground">
                {t("auth.password_hint")}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="up-pass-confirm">{t("auth.confirm_password")}</Label>
              <Input
                id="up-pass-confirm"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={confirmPassword.length > 0 && confirmPassword !== password}
              />
              {confirmPassword.length > 0 && confirmPassword !== password ? (
                <p className="text-xs text-destructive">{t("auth.password_mismatch")}</p>
              ) : null}
            </div>
            <div className="grid gap-3">
              <Label>{t("auth.intent_label")}</Label>
              <RadioGroup
                value={registrationIntent}
                onValueChange={(value) =>
                  setRegistrationIntent(value === "business" ? "business" : "explore")
                }
                className="gap-3"
              >
                <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                  <RadioGroupItem value="explore" className="mt-0.5" />
                  <span>{t("auth.intent_explore")}</span>
                </label>
                <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                  <RadioGroupItem value="business" className="mt-0.5" />
                  <span>{t("auth.intent_business")}</span>
                </label>
              </RadioGroup>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={termsAccepted}
                onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                className="mt-0.5"
              />
              <span>{t("auth.terms_accept")}</span>
            </label>
            <Button type="submit" disabled={busy}>
              {t("auth.signup")}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
