import { useState, useMemo } from "react";
import { MapIcon, List, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ClusterMap } from "@/components/map/ClusterMap";
import type { Business } from "@/types/domain";

interface MapToggleProps {
  businesses: Business[];
  className?: string;
}

export function MapToggle({ businesses, className }: MapToggleProps) {
  const t = useT();
  const [view, setView] = useState<"list" | "map">("list");

  const mapData = useMemo(
    () =>
      businesses
        .filter(
          (b): b is Business & { latitude: number; longitude: number } =>
            typeof b.latitude === "number" &&
            typeof b.longitude === "number" &&
            b.latitude !== 0 &&
            b.longitude !== 0,
        )
        .map((b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          latitude: b.latitude,
          longitude: b.longitude,
        })),
    [businesses],
  );

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {businesses.length.toLocaleString()} {t("common.results")}
        </p>
        <div className="flex overflow-hidden rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
              view === "list"
                ? "bg-brand text-brand-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <List className="h-3.5 w-3.5" aria-hidden="true" />
            List
          </button>
          <button
            type="button"
            onClick={() => setView("map")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
              view === "map"
                ? "bg-brand text-brand-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Map
          </button>
        </div>
      </div>

      {view === "list" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {businesses.map((b, i) => (
            <BusinessCard key={b.id} business={b} eager={i < 4} />
          ))}
        </div>
      ) : (
        <div className="relative aspect-[21/9] w-full overflow-hidden rounded-2xl border border-border">
          {mapData.length > 0 ? (
            <ClusterMap businesses={mapData} className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <Navigation className="h-6 w-6" aria-hidden="true" />
                <p>No location data available</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
