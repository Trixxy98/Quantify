import {useQuery} from "@tanstack/react-query";
import {getPortfolioRisk} from "../api/portfolio.api";
import type {Range} from "../types/api.types";

export function usePortfolioRisk(portfolioId: string | undefined, range: Range) {
    return useQuery({
        queryKey: ["portfolio", portfolioId, "risk", range],
        queryFn: () => getPortfolioRisk(portfolioId!, range),
        enabled: Boolean(portfolioId),
    });
}