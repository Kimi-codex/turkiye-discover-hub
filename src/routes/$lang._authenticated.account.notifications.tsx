import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import {
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
} from "@/lib/owner/owner.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocaleContext, type MessageKey } from "@/lib/i18n";

export const Route = createFileRoute("/$lang/_authenticated/account/notifications")({
  ssr: false,
  component: UserNotificationsPage,
});

function notificationHref(
  lang: string,
  n: { related_submission_id: string | null; related_business_id: string | null },
) {
  if (n.related_submission_id) return `/${lang}/owner/onboarding`;
  if (n.related_business_id) return `/${lang}/owner/${n.related_business_id}`;
  return `/${lang}/account`;
}

function UserNotificationsPage() {
  const { lang } = useParams({ strict: false }) as { lang: string };
  const { locale, t } = useLocaleContext();
  const qc = useQueryClient();
  const list = useServerFn(listUserNotifications);
  const markOne = useServerFn(markUserNotificationRead);
  const markAll = useServerFn(markAllUserNotificationsRead);
  const q = useQuery({ queryKey: ["user:notifications"], queryFn: () => list() });
  const markOneMutation = useMutation({
    mutationFn: (id: string) => markOne({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user:notifications"] }),
  });
  const markAllMutation = useMutation({
    mutationFn: () => markAll(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user:notifications"] }),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <h1 className="text-3xl font-bold tracking-tight">{t("notifications.title")}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("notifications.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => markAllMutation.mutate()}
          disabled={!q.data?.unread || markAllMutation.isPending}
        >
          {t("notifications.mark_all_read")}
        </Button>
      </header>

      {q.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : q.isError ? (
        <div className="mt-8 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {t("notifications.error")}
        </div>
      ) : (q.data?.rows ?? []).length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
          {t("notifications.empty")}
        </div>
      ) : (
        <ul className="mt-8 divide-y rounded-lg border bg-card">
          {q.data!.rows.map((n: any) => (
            <li key={n.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className={n.read_at ? "text-sm font-medium text-muted-foreground" : "text-sm font-semibold"}>
                    {t(n.title_key as MessageKey, n.message_params ?? undefined)}
                  </h2>
                  {!n.read_at ? <Badge variant="destructive">{t("notifications.unread")}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(n.message_key as MessageKey, n.message_params ?? undefined)}
                </p>
                <time className="mt-2 block text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString(locale)}
                </time>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to={notificationHref(lang, n)}>{t("notifications.open_related")}</Link>
                </Button>
                {!n.read_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markOneMutation.mutate(n.id)}
                    disabled={markOneMutation.isPending}
                  >
                    {t("notifications.mark_read")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
