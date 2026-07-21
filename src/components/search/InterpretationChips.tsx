import { X } from "lucide-react";
import type { InterpretationChip } from "@/lib/search/parseIntent";
import { cn } from "@/lib/utils";

interface InterpretationChipsProps {
  chips: InterpretationChip[];
  onRemove: (chip: InterpretationChip) => void;
  className?: string;
}

export function InterpretationChips({
  chips,
  onRemove,
  className,
}: InterpretationChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove(chip)}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand-soft px-3 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
        >
          <span>{chip.label}</span>
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
