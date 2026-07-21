import { LanguageSwitcher } from "./LanguageSwitcher";
import { useT } from "@/lib/i18n";

export function SiteFooter() {
  const t = useT();
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-black/5 bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row sm:px-6">
        <p className="text-xs text-muted-foreground">
          {t("home.footer.tagline", { year })}
        </p>
        <LanguageSwitcher variant="inline" />
      </div>
    </footer>
  );
}
