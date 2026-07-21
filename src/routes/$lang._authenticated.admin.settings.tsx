import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSettingsAdmin, updateSettingAdmin } from "@/lib/admin/domain.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/$lang/_authenticated/admin/settings")({
  ssr: false,
  component: SettingsPage,
});

const LABELS: Record<string, string> = {
  "import.default_status": "New businesses default status",
  "import.preserve_curated_fields": "Preserve admin/owner edits during import",
  "import.require_known_city": "Skip items with unknown city",
  "import.require_category_mapping": "Skip items without an approved category mapping",
  "reviews.auto_publish": "Auto-publish platform reviews",
  "images.queue_after_import": "Queue images for R2 upload after import",
};

const STATUS_CHOICES = ["draft", "pending_review", "published"] as const;

function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => getSettingsAdmin(),
  });
  const mut = useMutation({
    mutationFn: (v: { key: string; value: unknown }) => updateSettingAdmin({ data: v }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const keys = q.data?.keys ?? [];
  const map = new Map(
    (q.data?.rows ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value] as const),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="space-y-3">
        {keys.map((k) => {
          const value = map.get(k);
          return (
            <div key={k} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{LABELS[k] ?? k}</div>
                  <div className="text-xs text-muted-foreground font-mono">{k}</div>
                </div>
                <div>
                  {k === "import.default_status" ? (
                    <select
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                      value={String(value ?? "pending_review")}
                      onChange={(e) => mut.mutate({ key: k, value: e.target.value })}
                    >
                      {STATUS_CHOICES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Button
                      size="sm"
                      variant={value === true ? "default" : "outline"}
                      onClick={() => mut.mutate({ key: k, value: !value })}
                    >
                      {value === true ? "Enabled" : "Disabled"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
