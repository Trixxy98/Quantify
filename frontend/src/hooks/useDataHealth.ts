import {useQuery} from "@tanstack/react-query";
import {getDataHealth} from "../api/market.api";

export function useDataHealth() {
    return useQuery({
        queryKey: ["market", "health"],
        queryFn: getDataHealth,
    });
}
