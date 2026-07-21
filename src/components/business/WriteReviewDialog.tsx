import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { n as useAuth } from "@/hooks/n";
import { submitReview, getMyReviewForBusiness } from "@/lib/reviews/reviews.functions";
import { translate, type Locale } from "@/lib/i18n";

type Props = {
  businessId: string;
  locale: Locale;
  lang: string;
  trigger?: React.ReactNode;
};

export function WriteReviewDialog({ businessId, locale, lang, trigger }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);

  const submit = useServerFn(submitReview);
  const getMine = useServerFn(getMyReviewForBusiness);

  const mineQ = useQuery({
    queryKey: ["my-review", businessId, user?.id ?? "anon"],
    queryFn: () => getMine({ data: { businessId } }),
    enabled: !!user,
  });

  const mut = useMutation({
    mutationFn: () =>
      submit({ data: { businessId, rating, reviewText: text, language: locale } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(t("review.submitted"));
        setOpen(false);
        setRating(0);
        setText("");
        qc.invalidateQueries({ queryKey: ["my-review", businessId] });
      } else {
        toast.error(t("review.already_submitted"));
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const triggerBtn =
    trigger ?? (
      <Button variant="outline" size="sm">
        {t("biz.write_review")}
      </Button>
    );

  if (!user) {
    return (
      <span
        onClick={() =>
          navigate({
            to: "/$lang/auth",
            params: { lang },
            search: { redirect: window.location.pathname },
          })
        }
        className="inline-flex"
      >
        {triggerBtn}
      </span>
    );
  }

  const mine = mineQ.data;
  if (mine) {
    const label =
      mine.status === "pending"
        ? t("review.pending")
        : mine.status === "published"
          ? t("review.published_mine")
          : t("review.rejected_mine");
    return (
      <Button variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerBtn}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("review.dialog_title")}</DialogTitle>
          <DialogDescription>{t("review.dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("review.rating")}</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} stars`}
                  onClick={() => setRating(n)}
                  className="p-1"
                >
                  <Star
                    className={cn(
                      "h-7 w-7 transition",
                      n <= rating
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("review.text")}</label>
            <Textarea
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("review.placeholder")}
              maxLength={2000}
            />
            <div className="mt-1 text-right text-xs text-muted-foreground">
              {text.length}/2000
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={rating === 0 || text.trim().length < 5 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "…" : t("review.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
