import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import { cn } from "@/lib/utils";

interface MapBusiness {
  id: string;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  category?: string;
  rating?: number;
  url: string;
}

interface ClusterMapProps {
  businesses: MapBusiness[];
  className?: string;
  onBusinessClick?: (slug: string) => void;
}

const DEFAULT_ZOOM = 8;

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

export function ClusterMap({
  businesses,
  className,
  onBusinessClick,
}: ClusterMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });

    instanceRef.current = map;
    clusterRef.current = cluster;

    return () => {
      map.remove();
      instanceRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = instanceRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;

    cluster.clearLayers();

    if (businesses.length === 0) return;

    const valid = businesses.filter(
      (b) => typeof b.latitude === "number" && typeof b.longitude === "number",
    );
    if (valid.length === 0) return;

    const markers = valid.map((b) => {
      const marker = L.marker([b.latitude, b.longitude]);
      const popup = document.createElement("div");
      popup.className = "space-y-1";
      const title = document.createElement("a");
      title.href = b.url;
      title.textContent = b.name;
      title.className = "font-semibold text-brand hover:underline";
      popup.appendChild(title);
      if (b.category) {
        const category = document.createElement("div");
        category.textContent = b.category;
        category.className = "text-xs text-muted-foreground";
        popup.appendChild(category);
      }
      if (typeof b.rating === "number" && b.rating > 0) {
        const rating = document.createElement("div");
        rating.textContent = `★ ${b.rating.toFixed(1)}`;
        rating.className = "text-xs";
        popup.appendChild(rating);
      }
      marker.bindPopup(popup);
      if (onBusinessClick) {
        marker.on("click", () => onBusinessClick(b.slug));
      }
      return marker;
    });

    cluster.addLayers(markers);
    map.addLayer(cluster);

    if (valid.length === 1) {
      map.setView([valid[0].latitude, valid[0].longitude], 14);
    } else {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }, [businesses, onBusinessClick]);

  return (
    <div ref={mapRef} className={cn("h-full w-full", className)} />
  );
}
