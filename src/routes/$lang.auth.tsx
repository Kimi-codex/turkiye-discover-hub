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

function authErrorMessage(message: string, t: ReturnType<typeof useT>): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") || lower.includes("registered") || lower.includes("exists")) {
    return t("auth.error_already_registered");
  }
  if (lower.includes("invalid email") || lower.includes("email")) {
    return t("auth.error_invalid_email");
  }
  if (lower.includes("password")) {
    return t("auth.password_too_short");
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return t("auth.error_rate_limited");
  }
  return t("auth.error_generic");
}

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
  const [signupComplete, setSignupComplete] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        (supabase as any)
          .from("business_members")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "active")
          .in("role", ["owner", "manager"])
          .limit(1),
      ]).then(([roles, memberships]) => {
        const isAdmin = (roles.data ?? []).some((row: { role: string }) => row.role === "admin");
        const hasBusiness = (memberships.data ?? []).length > 0;
        navigate({
          to: isAdmin ? `/${locale}/admin` : hasBusiness ? `/${locale}/owner` : `/${locale}/account`,
          replace: true,
        });
      });
    }
  }, [user, loading, navigate, locale]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(authErrorMessage(error.message, t));
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
    if (error) return toast.error(authErrorMessage(error.message, t));
    // Generic message: never expose whether admin was granted.
    setSignupComplete(true);
    setPassword("");
    setConfirmPassword("");
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

      {signupComplete ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <h2 className="font-semibold text-foreground">{t("auth.account_created")}</h2>
          <p className="mt-1 text-muted-foreground">{t("auth.check_email")}</p>
        </div>
      ) : null}

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
