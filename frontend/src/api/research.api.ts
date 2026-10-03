import {apiClient} from "./client";
import type {AgentsOverview, MomentumStudy} from "../types/api.types";

export async function getAgents(): Promise<AgentsOverview> {
    const {data} = await apiClient.get<AgentsOverview>("/research/agents", {timeout: 120_000});
    return data;
}

export type MomentumQuery = {
    portfolioId?: string;
    universe: "holdings" | "basket";
    commissionBps: number;
    slippageBps: number;
    allowShort: boolean;
};

export async function getMomentum(query: MomentumQuery): Promise<MomentumStudy> {
    const {data} = await apiClient.get<MomentumStudy>("/research/momentum", {
        params: {
            portfolioId: query.portfolioId,
            universe: query.universe,
            commissionBps: query.commissionBps,
            slippageBps: query.slippageBps,
            short: query.allowShort ? "1" : "0",
        },
        timeout: 180_000,
    });
    return data;
}
