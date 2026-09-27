import {useQuery} from "@tanstack/react-query";
import {getFactorExposure} from "../api/portfolio.api";
import type {Range} from "../types/api.types";

export function useFactorExposure(portfolioId: string | undefined, range: Range) {
    return useQuery({
        queryKey: ["portfolio", portfolioId, "factors", range],
        queryFn: () => getFactorExposure(portfolioId!, range),
        enabled: Boolean(portfolioId),
    });
}
