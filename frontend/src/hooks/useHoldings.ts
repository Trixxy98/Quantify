import { useQuery } from "@tanstack/react-query";
import { listHoldings } from "../api/portfolio.api";

export function useHoldings(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "holdings"],
    queryFn: () => listHoldings(portfolioId!),
    enabled: Boolean(portfolioId),
  });
}