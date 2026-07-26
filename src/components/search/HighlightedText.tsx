import { Fragment, type ReactNode } from "react";

interface HighlightedTextProps {
  text: string;
  query: string;
  as?: "span" | "h3" | "p";
  className?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(query: string): string[] {
  return query
    .toLocaleLowerCase()
    .split(/[\s,;:.!?()-]+/)
    .filter((t) => t.length >= 2);
}

export function HighlightedText({
  text,
  query,
  as: Tag = "span",
  className,
}: HighlightedTextProps) {
  if (!query || !text) {
    return <Tag className={className}>{text}</Tag>;
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return <Tag className={className}>{text}</Tag>;
  }

  const pattern = tokens.map((t) => escapeRegex(t)).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");

  const parts = text.split(regex);

  const children: ReactNode[] = parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <mark key={i} className="rounded-sm bg-yellow-200/60 px-0.5 text-inherit">
          {part}
        </mark>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });

  return <Tag className={className}>{children}</Tag>;
}
