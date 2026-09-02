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
    realizedPnL: number;
    realizedPnLPct: number;
    totalPnL: number;
    closedLotCount: number;
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
    /** Error bar on the Sharpe, same annualized scale. */
    sharpeStandardError: number;
    beta: number;
    alpha: number;
    maxDrawdown: number;
    /** Dividends collected inside the range, base currency. */
    dividendIncome: number;
    /** Daily observations behind the risk statistics. */
    observations: number;
    isLowConfidence: boolean;
    /** "^SP500TR" (total return) or "^GSPC" (price only, pre-sync fallback). */
    usBenchmark: string;
};

export type PerformancePoint = {date: string; value: number};
export type BenchmarkPoint = {date: string; indexedValue: number};

export type PortfolioPerformance = {
    range: Range;
    series: PerformancePoint[];
    benchmarkSeries: BenchmarkPoint[];
    klciSeries: BenchmarkPoint[];
    spxSeries: BenchmarkPoint[];
    usBenchmark: string;
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

export type AttributionItem = {
    symbol: string;
    exchange: Exchange;
    currency: Currency;
    marketValue: number | null;
    weight: number;
    contribution: number;
    contributionShare: number;
    stockContribution: number;
    fxContribution: number;
    riskShare: number;
    beta: number;
};

export type ScenarioPosition = {
    symbol: string;
    exchange: Exchange;
    marketValue: number;
    beta: number;
    fxSensitivity: number;
};

export type PortfolioAnalysis = {
    range: Range;
    asOf: string | null;
    baseCurrency: Currency;
    days: number;
    totalValue: number;
    totalContribution: number;
    stockContribution: number;
    fxContribution: number;
    items: AttributionItem[];
    scenario: {
        totalValue: number;
        positions: ScenarioPosition[];
    };
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

export type UpdateTransactionInput = CreateTransactionInput;

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
    realizedPnL: number | null;
    realizedPnLPct: number | null;
    realizedPnLBase: number | null;
    closedPosition: boolean;
};

export type ClosedLot = {
    symbol: string;
    currency: Currency;
    openedAt: string;
    closedAt: string;
    quantity: number;
    cost: number;
    proceeds: number;
    realizedPnL: number;
    realizedPnLPct: number;
    realizedPnLBase: number;
};

export type ClosedLotsResponse = {
    baseCurrency: Currency;
    lots: ClosedLot[];
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

export type IvSurfacePoint = {
    expiry: string;
    ttm: number;
    strike: number;
    moneyness: number;
    iv: number;
    mid: number;
    right: "call" | "put";
    method: "newton" | "bisection";
    yahooIv: number | null;
};

export type IvSurface = {
    symbol: string;
    spot: number;
    rate: number;
    dividendYield: number;
    asOf: string;
    points: IvSurfacePoint[];
    newtonCount: number;
    bisectionCount: number;
};

export type TickerQuote = {
    symbol: string;
    name: string;
    price: number;
    change: number;
    /** Fraction, not percent: 0.0162 means +1.62%. */
    changePercent: number;
    currency: string;
    marketState: string;
    asOf: string | null;
};

export type EventType = "FOMC" | "CPI" | "EARNINGS";

export type EventStudyOffset = {
    offset: number;
    aar: number;
    aarSe: number;
    acar: number;
    acarSe: number;
    tStat: number;
};

export type EventStudyRow = {
    symbol: string;
    date: string;
    label: string;
    surprisePercent: number | null;
    alpha: number;
    beta: number;
    day0Return: number;
    day0Abnormal: number;
    car: number;
};

export type EventStudyStats = {
    n: number;
    mean: number;
    median: number;
    sd: number;
    p05: number;
    p95: number;
    hitRate: number;
};

export type EventStudyBucket = {
    from: number;
    to: number;
    eventShare: number;
    baselineShare: number;
};

export type EventStudyTrade = {
    symbol: string;
    entryDate: string;
    exitDate: string;
    ret: number;
    benchRet: number;
    excess: number;
};

export type EventStudy = {
    symbols: string[];
    eventType: EventType;
    benchmark: string;
    window: {pre: number; post: number};
    years: number;
    from: string;
    to: string;
    eventCount: number;
    skippedCount: number;
    offsets: EventStudyOffset[];
    events: EventStudyRow[];
    distribution: {
        event: EventStudyStats;
        baseline: EventStudyStats;
        buckets: EventStudyBucket[];
    };
    backtest: {
        holdDays: number;
        trades: EventStudyTrade[];
        equity: {date: string; value: number}[];
        stats: {
            trades: number;
            totalReturn: number;
            meanRet: number;
            medianRet: number;
            winRate: number;
            best: number;
            worst: number;
            maxDrawdown: number;
            tStat: number;
            timeInMarketPct: number;
            buyHoldReturn: number;
        };
    };
    notes: string[];
};