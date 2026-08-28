export type Currency = "MYR" | "USD";
export type Exchange = "BURSA" | "US";
export type Range = "1M" | "3M" | "6M" | "1Y" | "YTD" | "ALL";

export type Portfolio = {
    id: string;
    userId: string;
    name: string;
    baseCurrency: Currency;
    createdAt: string;
    updatedAt: string;
};

export type Holding = {
    id: string;
    portfolioId: string;
    symbol: string;
    exchange: Exchange;
    currency: Currency;
    quantity: string;
    avgCost: string;
    lastPrice: string | null;
    marketValue: number | null;
    unrealizedPnL: number | null;
    unrealizedPnLPct: number | null;
};

export type PortfolioSummary = {
    portfolioId: string;
    name: string;
    baseCurrency: Currency;
    totalValue: number;
    totalCost: number;
    unrealizedPnL: number;
    unrealizedPnLPct: number;
    todayReturnPct: number;
    todayReturnValue: number;
    asOfDate: string | null;
};

export type PortfolioMetrics = {
    range: Range;
    asOf: string;
    annualReturn: number;
    cagr: number;
    volatility: number;
    sharpeRatio: number;
    beta: number;
    alpha: number;
    maxDrawdown: number;
};

export type PerformancePoint = {date: string; value: number};
export type BenchmarkPoint = {date: string; indexedValue: number};

export type PortfolioPerformance = {
    range: Range;
    series: PerformancePoint[];
    benchmarkSeries: BenchmarkPoint[];
};

export type AllocationItem = {
    symbol: string;
    exchange: Exchange;
    marketValue: number;
    percentage: number;
};

export type PortfolioAllocation = {
    totalValue: number;
    items: AllocationItem[];
};

export type PricePoint = {date: string; close: number};

export type HoldingPriceSeries = {
    symbol: string;
    currency: Currency;
    range: Range;
    series: PricePoint[];
};

export type SymbolSearchHit = {
    symbol: string;
    name: string;
    exchange: string;
};

export type TransactionType = "BUY" | "SELL";

export type CreateTransactionInput = {
    symbol: string;
    type: TransactionType;
    quantity: number;
    price: number;
    currency: Currency;
    fee?: number;
    date: string;
};

export type Transaction = {
    id: string;
    portfolioId: string;
    symbol: string;
    type: TransactionType;
    quantity: string;
    price: string;
    currency: Currency;
    fee: string;
    date: string;
};

export type TransactionListResponse = {
    data: Transaction[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};