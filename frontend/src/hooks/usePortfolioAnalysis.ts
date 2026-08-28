import { useQuery } from "@tanstack/react-query";
import { getPortfolioAnalysis } from "../api/portfolio.api";
import type { Range } from "../types/api.types";

export function usePortfolioAnalysis(portfolioId: string | undefined, range: Range) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "analysis", range],
    queryFn: () => getPortfolioAnalysis(portfolioId!, range),
    enabled: Boolean(portfolioId),
  });
}
