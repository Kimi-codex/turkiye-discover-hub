import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/use-auth";
import { useT, useLocaleContext } from "@/lib/i18n";

export const Route = createFileRoute("/$lang/auth")({
  head: () => ({
    meta: [
      { title: "Giriş Yap · TurkeyDirect" },
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
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/${locale}`,
        data: { full_name: name, preferred_language: locale },
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
      toast.error(res.error.message ?? "Google sign-in failed");
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
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={busy}>
              {t("auth.signup")}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
