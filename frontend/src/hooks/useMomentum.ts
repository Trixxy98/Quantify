import {useQuery} from "@tanstack/react-query";
import {getMomentum, type MomentumQuery} from "../api/research.api";

export function useMomentum(query: MomentumQuery, enabled: boolean) {
    return useQuery({
        queryKey: ["research", "momentum", query],
        queryFn: () => getMomentum(query),
        enabled,
        staleTime: 5 * 60_000,
        retry: 0,
    });
}
