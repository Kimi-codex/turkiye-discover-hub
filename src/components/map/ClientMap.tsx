import { useEffect, useRef, useState, lazy, type ComponentType } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClientBusinessMapProps {
  latitude: number;
  longitude: number;
  name: string;
  googleMapsUrl?: string | null;
  className?: string;
}

interface ClientClusterMapProps {
  businesses: Array<{ id: string; name: string; slug: string; latitude: number; longitude: number }>;
  className?: string;
  onBusinessClick?: (slug: string) => void;
}

/**
 * Client-side only business detail map. Falls back to a placeholder during SSR.
 */
export function ClientBusinessMap(props: ClientBusinessMapProps) {
  const { className } = props;
  const [Mounted, setMounted] = useState<ComponentType<ClientBusinessMapProps> | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    import("./BusinessMap").then((mod) => {
      const Component = mod.BusinessMap;
      setMounted(() => Component);
    });
  }, []);

  if (!Mounted) {
    return (
      <div
        className={cn("grid aspect-[16/8] w-full place-items-center bg-surface-muted text-muted-foreground rounded-2xl", className)}
        aria-label="Map preview"
      >
        <MapPin className="h-8 w-8" aria-hidden="true" />
      </div>
    );
  }

  return <Mounted {...props} />;
}

/**
 * Client-side only clustered map. Falls back to a placeholder during SSR.
 */
export function ClientClusterMap(props: ClientClusterMapProps) {
  const { className } = props;
  const [Mounted, setMounted] = useState<ComponentType<ClientClusterMapProps> | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    import("./ClusterMap").then((mod) => {
      const Component = mod.ClusterMap;
      setMounted(() => Component);
    });
  }, []);

  if (!Mounted) {
    return (
      <div
        className={cn("flex aspect-[21/9] w-full items-center justify-center bg-muted text-sm text-muted-foreground rounded-2xl", className)}
      >
        <MapPin className="h-6 w-6" aria-hidden="true" />
      </div>
    );
  }

  return <Mounted {...props} />;
}
