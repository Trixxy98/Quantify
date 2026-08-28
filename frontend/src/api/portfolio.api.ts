import { apiClient } from "./client";
import type {
  CreateTransactionInput,
  Currency,
  Holding,
  HoldingPriceSeries,
  Portfolio,
  PortfolioAllocation,
  PortfolioMetrics,
  PortfolioPerformance,
  PortfolioSummary,
  Range,
  TransactionListResponse,
} from "../types/api.types";

export async function createTransaction(portfolioId: string, input: CreateTransactionInput) {
  const {data} = await apiClient.post(`/portfolios/${portfolioId}/transactions`, input);
  return data;
}

export async function syncMarketData() {
  const {data} = await apiClient.post("/sync");
  return data;
}

export async function listPortfolios(): Promise<Portfolio[]> {
  const { data } = await apiClient.get<Portfolio[]>("/portfolios");
  return data;
}

export async function getPortfolioSummary(portfolioId: string): Promise<PortfolioSummary> {
  const { data } = await apiClient.get<PortfolioSummary>(`/portfolios/${portfolioId}/summary`);
  return data;
}

export async function getPortfolioMetrics(portfolioId: string, range: Range): Promise<PortfolioMetrics> {
  const { data } = await apiClient.get<PortfolioMetrics>(`/portfolios/${portfolioId}/metrics`, {
    params: { range },
  });
  return data;
}

export async function getPortfolioPerformance(
  portfolioId: string,
  range: Range
): Promise<PortfolioPerformance> {
  const { data } = await apiClient.get<PortfolioPerformance>(`/portfolios/${portfolioId}/performance`, {
    params: { range },
  });
  return data;
}

export async function getPortfolioAllocation(portfolioId: string): Promise<PortfolioAllocation> {
  const { data } = await apiClient.get<PortfolioAllocation>(`/portfolios/${portfolioId}/allocation`);
  return data;
}

export async function listHoldings(portfolioId: string): Promise<Holding[]> {
  const { data } = await apiClient.get<Holding[]>(`/portfolios/${portfolioId}/holdings`);
  return data;
}

export async function getHoldingPrices(
  portfolioId: string,
  symbol: string,
  range: Range
): Promise<HoldingPriceSeries> {
  const {data} = await apiClient.get<HoldingPriceSeries>(
    `/portfolios/${portfolioId}/prices/${encodeURIComponent(symbol)}`,
    {params: {range}}
  );
  return data;
}

export async function createPortfolio(name: string, baseCurrency: Currency = "MYR"): Promise<Portfolio> {
  const {data} = await apiClient.post<Portfolio>("/portfolios", {name, baseCurrency});
  return data;
}

export async function updatePortfolio(
  portfolioId: string,
  data: {name?: string; baseCurrency?: Currency}
): Promise<Portfolio> {
  const {data: portfolio} = await apiClient.patch<Portfolio>(`/portfolios/${portfolioId}`, data);
  return portfolio;
}

export async function deletePortfolio(portfolioId: string): Promise<void> {
  await apiClient.delete(`/portfolios/${portfolioId}`);
}

export async function listTransactions(
  portfolioId: string,
  page = 1,
  limit = 20
): Promise<TransactionListResponse> {
  const {data} = await apiClient.get<TransactionListResponse>(
    `/portfolios/${portfolioId}/transactions`,
    {params: {page, limit}}
  );
  return data;
}

export async function deleteTransaction(portfolioId: string, transactionId: string): Promise<void> {
  await apiClient.delete(`/portfolios/${portfolioId}/transactions/${transactionId}`);
}