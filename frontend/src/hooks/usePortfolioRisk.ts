import {useQuery} from "@tanstack/react-query";
import {getPortfolioRisk} from "../api/portfolio.api";
import type {Range} from "../types/api.types";

export function usePortfolioRisk(
    portfolioId: string | undefined,
    range: Range,
    window: 20 | 60 | 120 = 60
) {
    return useQuery({
        queryKey: ["portfolio", portfolioId, "risk", range, window],
        queryFn: () => getPortfolioRisk(portfolioId!, range, window),
        enabled: Boolean(portfolioId),
    });
}