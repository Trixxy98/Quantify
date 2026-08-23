import { useQuery } from "@tanstack/react-query";
import { getPortfolioSummary } from "../api/portfolio.api";

export function usePortfolioSummary(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "summary"],
    queryFn: () => getPortfolioSummary(portfolioId!),
    enabled: Boolean(portfolioId),
  });
}