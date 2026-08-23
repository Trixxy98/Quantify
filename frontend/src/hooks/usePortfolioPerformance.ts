import { useQuery } from "@tanstack/react-query";
import { getPortfolioPerformance } from "../api/portfolio.api";
import type { Range } from "../types/api.types";

export function usePortfolioPerformance(portfolioId: string | undefined, range: Range) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "performance", range],
    queryFn: () => getPortfolioPerformance(portfolioId!, range),
    enabled: Boolean(portfolioId),
  });
}