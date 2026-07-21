import { useState, type FormEvent } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface ClarificationCardProps {
  query: string;
  questionKey: MessageKey;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  className?: string;
}

export function ClarificationCard({
  query,
  questionKey,
  onAnswer,
  onSkip,
  className,
}: ClarificationCardProps) {
  const t = useT();
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v) onAnswer(v);
  }

  return (
    <section
      aria-labelledby="clarify-title"
      className={cn(
        "rounded-3xl border border-black/5 bg-white p-5 shadow-[0_10px_30px_-15px_rgba(15,15,40,0.15)] sm:p-6",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id="clarify-title"
            className="font-display text-base font-bold text-primary sm:text-lg"
          >
            {t("search.clarify.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            {t("search.clarify.subtitle")}
          </p>
        </div>
      </div>

      {query && (
        <div className="mt-5 flex justify-end">
          <span className="inline-block max-w-full truncate rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-foreground sm:text-sm">
            {query}
          </span>
        </div>
      )}

      <div className="mt-4 flex">
        <span className="rounded-2xl bg-muted px-4 py-2 text-xs text-foreground sm:text-sm">
          {t(questionKey)}
        </span>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("search.clarify.placeholder")}
          className="min-w-0 flex-1 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-brand/40 focus:ring-2 focus:ring-brand/20"
          aria-label={t("search.clarify.placeholder")}
        />
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            className="gap-1.5 rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
            disabled={!value.trim()}
          >
            <Send className="h-4 w-4 rtl-flip" aria-hidden="true" />
            {t("search.clarify.send")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={onSkip}
          >
            {t("search.clarify.skip")}
          </Button>
        </div>
      </form>
    </section>
  );
}
