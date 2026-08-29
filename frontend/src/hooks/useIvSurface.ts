import { useQuery } from "@tanstack/react-query";
import { getIvSurface } from "../api/market.api";

export function useIvSurface(symbol: string) {
  const ticker = symbol.trim().toUpperCase();
  const ready = /^[A-Z]{1,5}$/.test(ticker);

  return useQuery({
    queryKey: ["market", "iv-surface", ticker],
    queryFn: () => getIvSurface(ticker),
    enabled: ready,
    staleTime: 60_000,
    retry: 1,
  });
}
