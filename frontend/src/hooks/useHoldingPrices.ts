import { useQuery } from "@tanstack/react-query";
import { getHoldingPrices } from "../api/portfolio.api";
import type { Range } from "../types/api.types";

export function useHoldingPrices(
  portfolioId: string | undefined,
  symbol: string | undefined,
  range: Range
) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "prices", symbol, range],
    queryFn: () => getHoldingPrices(portfolioId!, symbol!, range),
    enabled: Boolean(portfolioId && symbol),
  });
}
