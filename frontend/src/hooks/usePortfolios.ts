import { useQuery } from "@tanstack/react-query";
import { listPortfolios } from "../api/portfolio.api";

export function usePortfolios() {
  return useQuery({
    queryKey: ["portfolios"],
    queryFn: listPortfolios,
  });
}