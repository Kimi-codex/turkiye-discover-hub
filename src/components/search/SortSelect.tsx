import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortOption } from "@/types/domain";
import { useT } from "@/lib/i18n";

const OPTIONS: SortOption[] = [
  "recommended",
  "highest_rated",
  "most_reviewed",
  "recently_added",
  "name",
];

interface SortSelectProps {
  value: SortOption;
}

export function SortSelect({ value }: SortSelectProps) {
  const t = useT();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {t("sort.label")}:
      </span>
      <Select
        value={value}
        onValueChange={(next) => {
          navigate({
            to: pathname,
            search: (prev: Record<string, unknown> | undefined) => ({
              ...(prev ?? {}),
              sort: next as SortOption,
              page: 1,
            }),
          });
        }}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {t(`sort.${opt}` as import("@/lib/i18n").MessageKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
