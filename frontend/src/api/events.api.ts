import { apiClient } from "./client";
import type { EventStudy, EventType, VariancePremium } from "../types/api.types";

export type EventStudyQuery = {
  symbols: string[];
  type: EventType;
  pre: number;
  post: number;
  years: number;
  hold: number;
};

export async function getEventStudy(query: EventStudyQuery): Promise<EventStudy> {
  const {data} = await apiClient.get<EventStudy>("/events/study", {
    params: {
      symbols: query.symbols.join(","),
      type: query.type,
      pre: query.pre,
      post: query.post,
      years: query.years,
      hold: query.hold,
    },
    timeout: 60_000,
  });
  return data;
}

export async function getVariancePremium(
  symbol: string,
  type: EventType,
  years: number
): Promise<VariancePremium> {
  const {data} = await apiClient.get<VariancePremium>("/events/premium", {
    params: {symbol, type, years},
    timeout: 60_000,
  });
  return data;
}
