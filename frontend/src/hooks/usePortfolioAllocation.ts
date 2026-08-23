import { useQuery } from "@tanstack/react-query";
import { getPortfolioAllocation } from "../api/portfolio.api";

export function usePortfolioAllocation(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "allocation"],
    queryFn: () => getPortfolioAllocation(portfolioId!),
    enabled: Boolean(portfolioId),
  });
}