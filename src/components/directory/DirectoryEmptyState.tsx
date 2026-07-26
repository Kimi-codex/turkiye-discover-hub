import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n";

interface DirectoryEmptyStateProps {
  title?: string;
  description?: string;
}

export function DirectoryEmptyState({
  title,
  description,
}: DirectoryEmptyStateProps) {
  const locale = useLocale();
  const t = useT();

  return (
    <div className="rounded-3xl border border-dashed border-border bg-card p-8 text-center sm:p-10">
      <h2 className="text-lg font-semibold">{title ?? t("search.no_results.title")}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        {description ?? t("search.no_results.desc")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link to="/$lang" params={{ lang: locale }}>
            {t("common.back_home")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
