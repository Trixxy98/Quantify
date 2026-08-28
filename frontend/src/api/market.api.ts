import { apiClient } from "./client";
import type { Currency, SymbolSearchHit } from "../types/api.types";

export async function searchSymbols(query: string): Promise<SymbolSearchHit[]> {
  const {data} = await apiClient.get<SymbolSearchHit[]>("/market/search", {
    params: {q: query},
  });
  return data;
}

export type MarketClose = {
  symbol: string;
  date: string;
  close: number;
  currency: Currency;
};

export async function getMarketClose(symbol: string, date: string): Promise<MarketClose | null> {
  const {data} = await apiClient.get<MarketClose | null>("/market/close", {
    params: {symbol, date},
  });
  return data;
}
