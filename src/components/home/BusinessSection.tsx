import type { Business } from "@/types/domain";
import { BusinessCard } from "@/components/business/BusinessCard";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n";

interface BusinessSectionProps {
  titleKey: MessageKey;
  businesses: Business[];
}

export function BusinessSection({ titleKey, businesses }: BusinessSectionProps) {
  const t = useT();
  if (businesses.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h2 className="text-xl font-bold sm:text-2xl">{t(titleKey)}</h2>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {businesses.slice(0, 8).map((b) => (
          <BusinessCard key={b.id} business={b} />
        ))}
      </div>
    </section>
  );
}
