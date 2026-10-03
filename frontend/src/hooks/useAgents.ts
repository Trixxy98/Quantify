import {useQuery} from "@tanstack/react-query";
import {getAgents} from "../api/research.api";

export function useAgents() {
    return useQuery({
        queryKey: ["research", "agents"],
        queryFn: getAgents,
        staleTime: 5 * 60_000,
        retry: 0,
    });
}
