import {useQuery} from "@tanstack/react-query";
import {listTransactions} from "../api/portfolio.api";

export function useTransactions(portfolioId: string | undefined, page: number) {
    return useQuery({
        queryKey: ["portfolio", portfolioId, "transactions", page],
        queryFn: () => listTransactions(portfolioId!, page),
        enabled: Boolean(portfolioId),
    });
}