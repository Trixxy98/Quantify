import { apiClient } from "./client";
import type { Currency, IvSurface, SymbolSearchHit, TickerQuote } from "../types/api.types";

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

export async function getQuotes(symbols: string[]): Promise<TickerQuote[]> {
  const {data} = await apiClient.get<TickerQuote[]>("/market/quotes", {
    params: {symbols: symbols.join(",")},
  });
  return data;
}

export async function getIvSurface(symbol: string): Promise<IvSurface> {
  const {data} = await apiClient.get<IvSurface>("/market/iv-surface", {
    params: {symbol},
    timeout: 60_000,
  });
  return data;
}
