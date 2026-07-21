import type { OpeningHour } from "@/types/domain";

/**
 * Returns whether the business is open right now.
 * Returns null when the schedule is empty/unknown so callers can hide the badge.
 */
export function isOpenNow(hours: OpeningHour[]): boolean | null {
  if (!hours || hours.length === 0) return null;
  const now = new Date();
  const day = now.getDay();
  const today = hours.find((h) => h.dayOfWeek === day);
  if (!today) return null;
  if (today.isClosed || !today.openTime || !today.closeTime) return false;
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  // Handle overnight ranges (e.g. 20:00 – 02:00) as a simple wrap.
  if (today.closeTime > today.openTime) {
    return hhmm >= today.openTime && hhmm <= today.closeTime;
  }
  return hhmm >= today.openTime || hhmm <= today.closeTime;
}

export function todayHours(hours: OpeningHour[]): OpeningHour | null {
  if (!hours || hours.length === 0) return null;
  const day = new Date().getDay();
  return hours.find((h) => h.dayOfWeek === day) ?? null;
}
