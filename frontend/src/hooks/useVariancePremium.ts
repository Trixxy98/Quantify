import { useQuery } from "@tanstack/react-query";
import { getVariancePremium } from "../api/events.api";
import type { EventType } from "../types/api.types";

export function useVariancePremium(symbol: string, type: EventType, years: number) {
  const ticker = symbol.trim().toUpperCase();
  const ready = /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker);

  return useQuery({
    queryKey: ["events", "premium", ticker, type, years],
    queryFn: () => getVariancePremium(ticker, type, years),
    enabled: ready,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
