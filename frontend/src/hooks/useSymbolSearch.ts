import { useQuery } from "@tanstack/react-query";
import { searchSymbols } from "../api/market.api";

export function useSymbolSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["market", "search", q],
    queryFn: () => searchSymbols(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}
