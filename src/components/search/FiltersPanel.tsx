import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useLocale, useT, pickLocalized, localePath } from "@/lib/i18n";
import type { Category, City, District, SearchFilters } from "@/types/domain";
import { cn } from "@/lib/utils";

interface FiltersPanelProps {
  filters: Partial<SearchFilters>;
  categories: Category[];
  cities: City[];
  districts?: District[];
  showOpenNow?: boolean;
  className?: string;
  onClose?: () => void;
}

/**
 * Filters panel driven entirely by URL search params.
 * The parent search route owns validateSearch; this panel merges partial updates.
 */
export function FiltersPanel({
  filters,
  categories,
  cities,
  districts = [],
  showOpenNow = false,
  className,
  onClose,
}: FiltersPanelProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  function update(next: Partial<SearchFilters>) {
    navigate({
      to: pathname,
      search: (prev: Record<string, unknown> | undefined) => ({
        ...(prev ?? {}),
        ...next,
        page: 1,
      }),
    });
  }

  function clearAll() {
    navigate({
      to: localePath(locale, "/search"),
      search: {},
    });
    onClose?.();
  }

  return (
    <aside
      className={cn(
        "flex flex-col gap-6 rounded-2xl border border-border bg-card p-5",
        className,
      )}
      aria-label={t("filters.title")}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("filters.title")}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {t("filters.clear")}
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={t("nav.close")}
              className="lg:hidden"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <FilterGroup title={t("filters.category")}>
        <RadioLike
          items={[
            { value: null, label: t("sort.recommended") },
            ...categories.map((c) => ({
              value: c.slug,
              label: pickLocalized(c.name, locale),
            })),
          ]}
          value={filters.category ?? null}
          onChange={(v) => update({ category: v })}
          name="category"
        />
      </FilterGroup>

      <FilterGroup title={t("filters.city")}>
        <RadioLike
          items={[
            { value: null, label: t("sort.recommended") },
            ...cities.map((c) => ({
              value: c.slug,
              label: pickLocalized(c.name, locale),
            })),
          ]}
          value={filters.city ?? null}
          onChange={(v) => update({ city: v })}
          name="city"
        />
      </FilterGroup>

      {filters.city && districts.length > 0 && (
        <FilterGroup title={t("filters.district")}>
          <RadioLike
            items={[
              { value: null, label: t("sort.recommended") },
              ...districts
                .filter((d) => d.cityId === cities.find((c) => c.slug === filters.city)?.id)
                .map((d) => ({
                  value: d.slug,
                  label: pickLocalized(d.name, locale),
                })),
            ]}
            value={filters.district ?? null}
            onChange={(v) => update({ district: v })}
            name="district"
          />
        </FilterGroup>
      )}

      <FilterGroup title={t("filters.rating")}>
        <div className="flex flex-wrap gap-2">
          {[4.5, 4, 3.5, 3].map((r) => {
            const active = filters.rating === r;
            return (
              <button
                type="button"
                key={r}
                onClick={() => update({ rating: active ? null : r })}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent",
                )}
              >
                <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                {r}+
              </button>
            );
          })}
        </div>
      </FilterGroup>

      <FilterGroup title={t("filters.price")}>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((p) => {
            const active = filters.priceLevel === p;
            return (
              <button
                type="button"
                key={p}
                onClick={() => update({ priceLevel: active ? null : p })}
                aria-pressed={active}
                className={cn(
                  "inline-flex min-w-[3rem] items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent",
                )}
              >
                {"$".repeat(p)}
              </button>
            );
          })}
        </div>
      </FilterGroup>

      {showOpenNow && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="filter-open-now"
            checked={!!filters.openNow}
            onCheckedChange={(v) => update({ openNow: v === true })}
          />
          <Label htmlFor="filter-open-now" className="cursor-pointer text-sm">
            {t("filters.open_now")}
          </Label>
        </div>
      )}
    </aside>
  );
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function RadioLike<T extends string | null>({
  items,
  value,
  onChange,
  name,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div className="space-y-1.5" role="radiogroup" aria-label={name}>
      {items.map((item) => {
        const id = `${name}-${item.value ?? "any"}`;
        const active = value === item.value;
        return (
          <label
            key={id}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              active ? "bg-accent font-medium text-foreground" : "hover:bg-accent/60",
            )}
          >
            <input
              type="radio"
              id={id}
              name={name}
              checked={active}
              onChange={() => onChange(item.value)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>{item.label}</span>
          </label>
        );
      })}
    </div>
  );
}
