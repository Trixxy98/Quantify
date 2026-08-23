import { apiClient } from "./client";
import type {
  Holding,
  Portfolio,
  PortfolioAllocation,
  PortfolioMetrics,
  PortfolioPerformance,
  PortfolioSummary,
  Range,
} from "../types/api.types";

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