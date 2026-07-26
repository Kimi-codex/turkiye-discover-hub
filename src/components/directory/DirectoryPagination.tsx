import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DirectoryPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  className?: string;
}

export function DirectoryPagination({
  page,
  pageSize,
  total,
  className,
}: DirectoryPaginationProps) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  if (totalPages <= 1) return null;

  function goToPage(nextPage: number) {
    navigate({
      to: pathname,
      search: (prev: Record<string, unknown> | undefined) => ({
        ...(prev ?? {}),
        page: nextPage > 1 ? nextPage : undefined,
      }),
    });
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-between gap-3", className)}
    >
      <Button
        type="button"
        variant="outline"
        disabled={!hasPrevious}
        onClick={() => goToPage(currentPage - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="me-1 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        Previous
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        Page {currentPage} of {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={!hasNext}
        onClick={() => goToPage(currentPage + 1)}
        aria-label="Next page"
      >
        Next
        <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
    </nav>
  );
}
