import { useQuery } from "@tanstack/react-query";
import { getQuotes } from "../api/market.api";

const REFRESH_MS = 30_000;

export function useTickerQuotes(symbols: string[], enabled = true) {
  return useQuery({
    queryKey: ["market", "quotes", symbols],
    queryFn: () => getQuotes(symbols),
    enabled: enabled && symbols.length > 0,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS / 2,
    retry: 1,
  });
}
