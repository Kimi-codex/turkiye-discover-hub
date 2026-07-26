import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBusinessMapPopup } from "./map-popup";

interface BusinessMapProps {
  latitude: number;
  longitude: number;
  name: string;
  googleMapsUrl?: string | null;
  className?: string;
}

const DEFAULT_ZOOM = 15;

// Fix Leaflet default icon paths for bundled environments
try {
  delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
} catch {
  // Leaflet may not be fully loaded yet; icons fall back to default
}

export function BusinessMap({
  latitude,
  longitude,
  name,
  googleMapsUrl,
  className,
}: BusinessMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [latitude, longitude],
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    const popup = createBusinessMapPopup(name);

    L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup(popup);

    instanceRef.current = map;

    return () => {
      map.remove();
      instanceRef.current = null;
    };
  }, [latitude, longitude, name]);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl", className)}>
      <div ref={mapRef} className="h-full w-full" />
      {googleMapsUrl && (
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 right-3 z-[1000] flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-foreground shadow-md ring-1 ring-black/5 transition-colors hover:bg-muted"
        >
          <Navigation className="h-3 w-3" aria-hidden="true" />
          Open in Google Maps
        </a>
      )}
    </div>
  );
}
