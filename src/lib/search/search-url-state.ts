import {
  removeConsumedIntentTerm,
  type InterpretationChip,
  type ParsedIntent,
} from "./parseIntent";

export interface SearchStateLike {
  q?: unknown;
  category?: unknown;
  city?: unknown;
  district?: unknown;
  rating?: unknown;
  priceLevel?: unknown;
  audience?: unknown;
  sort?: unknown;
  page?: unknown;
  intent?: unknown;
  clarify?: unknown;
}

export function cleanPublicSearchState(state: SearchStateLike): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  if (typeof state.q === "string" && state.q.trim()) clean.q = state.q.trim();
  for (const key of ["category", "city", "district", "rating", "priceLevel", "audience"] as const) {
    if (state[key] !== null && state[key] !== undefined && state[key] !== "") clean[key] = state[key];
  }
  if (state.sort && state.sort !== "recommended") clean.sort = state.sort;
  if (typeof state.page === "number" && state.page > 1) clean.page = state.page;
  return clean;
}

export function removePublicSearchChip(
  state: SearchStateLike,
  chip: InterpretationChip,
  intent: ParsedIntent,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...state };
  if (
    chip.urlParam === "category" ||
    chip.urlParam === "city" ||
    chip.urlParam === "district" ||
    chip.urlParam === "priceLevel" ||
    chip.urlParam === "rating" ||
    chip.urlParam === "audience"
  ) {
    next.q = removeConsumedIntentTerm(typeof next.q === "string" ? next.q : "", intent, chip.urlParam);
  }
  next[chip.urlParam] = null;
  next.intent = null;
  next.clarify = null;
  next.page = 1;
  return cleanPublicSearchState(next);
}
