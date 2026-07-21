import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { OpeningHour } from "@/types/domain";
import { useT } from "@/lib/i18n";
import { isOpenNow, todayHours } from "@/lib/business/opening-hours";
import { cn } from "@/lib/utils";

interface OpeningHoursProps {
  hours: OpeningHour[];
}

export function OpeningHoursBlock({ hours }: OpeningHoursProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const today = todayHours(hours);
  const status = isOpenNow(hours);
  const sorted = [...hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const todayDay = new Date().getDay();

  const label = today?.isClosed
    ? t("card.closed_now")
    : status
      ? `${t("card.open_now")} · ${today?.openTime} – ${today?.closeTime}`
      : today?.openTime
        ? `${t("card.closed_now")} · ${today?.openTime} – ${today?.closeTime}`
        : t("card.closed_now");

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-start"
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {t("biz.opening_hours")}
          </div>
          <div
            className={cn(
              "mt-1 text-sm",
              status ? "text-success" : "text-muted-foreground",
            )}
          >
            {label}
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
          {sorted.map((h) => (
            <li
              key={h.dayOfWeek}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1",
                h.dayOfWeek === todayDay && "bg-accent font-medium",
              )}
            >
              <span className="text-foreground">
                {t(`days.${h.dayOfWeek}` as import("@/lib/i18n").MessageKey)}
              </span>
              <span className="text-muted-foreground">
                {h.isClosed || !h.openTime
                  ? t("card.closed_now")
                  : `${h.openTime} – ${h.closeTime}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
