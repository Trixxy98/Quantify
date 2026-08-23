import { useQuery } from "@tanstack/react-query";
import { getPortfolioMetrics } from "../api/portfolio.api";
import type { Range } from "../types/api.types";

export function usePortfolioMetrics(portfolioId: string | undefined, range: Range) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "metrics", range],
    queryFn: () => getPortfolioMetrics(portfolioId!, range),
    enabled: Boolean(portfolioId),
  });
}