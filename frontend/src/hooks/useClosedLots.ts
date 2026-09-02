import { useQuery } from "@tanstack/react-query";
import { listClosedLots } from "../api/portfolio.api";

export function useClosedLots(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", portfolioId, "closed-lots"],
    queryFn: () => listClosedLots(portfolioId!),
    enabled: Boolean(portfolioId),
  });
}
