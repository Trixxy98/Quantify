import { useQuery } from "@tanstack/react-query";
import { getMarketClose } from "../api/market.api";

const TICKER = /^[A-Z0-9]+(\.[A-Z]{1,3})?$/;

export function useMarketClose(symbol: string, date: string) {
  const ticker = symbol.trim().toUpperCase();
  const ready = TICKER.test(ticker) && /^\d{4}-\d{2}-\d{2}$/.test(date);

  return useQuery({
    queryKey: ["market", "close", ticker, date],
    queryFn: () => getMarketClose(ticker, date),
    enabled: ready,
    staleTime: 60_000,
  });
}
