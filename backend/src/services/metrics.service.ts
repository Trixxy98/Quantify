import { average, stdDev, variance, covariance } from "../utils/stats.util";

export type DailyValue = {date: string; value: number};

// Identical returns do not cancel to exactly zero in floating point: the
// residue is around 1e-19, which is enough to divide by and produce a Sharpe
// of 1e17. Real daily dispersion never lands below these floors.
const MIN_STD_DEV = 1e-12;
const MIN_VARIANCE = MIN_STD_DEV * MIN_STD_DEV;

export function toDailyReturns(series: DailyValue[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < series.length; i++) {
        returns.push((series[i].value - series[i - 1].value) / series[i -1].value);
    }
    return returns;
}

export function todayReturn(series: DailyValue[]): number {
    const n = series.length;
    if (n < 2) return 0;
    return (series[n-1].value - series[n-2].value) / series[n-2].value;
}

export function annualizedReturn(dailyReturns: number[], tradingDaysPerYear = 252): number {
    if (dailyReturns.length === 0) return 0;
    const totalCompounded = dailyReturns.reduce((acc, r) => acc * (1 + r), 1);
    if (totalCompounded <= 0) return -1;
    const years = dailyReturns.length / tradingDaysPerYear;
    return Math.pow(totalCompounded, 1 / years) -1;
}

export function cagr(startValue: number, endValue: number, years: number): number {
    if (startValue <= 0 || endValue <= 0 || years <= 0) return 0;
    return Math.pow(endValue / startValue, 1 / years) -1;
}

export function volatility(dailyReturns: number[], tradingDaysPerYear = 252): number {
    return stdDev(dailyReturns) * Math.sqrt(tradingDaysPerYear);
  }

  export function sharpeRatio(dailyReturns: number[], riskFreeAnnualRate: number, tradingDaysPerYear = 252): number {
    const rfDaily = riskFreeAnnualRate / tradingDaysPerYear;   
    const excessReturns = dailyReturns.map((r) => r - rfDaily);
    const std = stdDev(excessReturns);
    if (!Number.isFinite(std) || std < MIN_STD_DEV) return 0;
    return (average(excessReturns) / std) * Math.sqrt(tradingDaysPerYear);
}

/**
 * Asymptotic standard error of the Sharpe ratio, on the same annualised scale
 * as `sharpeRatio`. A Sharpe of 1.2 over three months carries an error bar
 * wide enough to include zero, and the dashboard should be able to say so.
 */
export function sharpeStandardError(
    dailyReturns: number[],
    riskFreeAnnualRate: number,
    tradingDaysPerYear = 252
): number {
    const n = dailyReturns.length;
    if (n < 2) return 0;
    const rfDaily = riskFreeAnnualRate / tradingDaysPerYear;
    const excess = dailyReturns.map((r) => r - rfDaily);
    const std = stdDev(excess);
    if (!Number.isFinite(std) || std < MIN_STD_DEV) return 0;
    const srDaily = average(excess) / std;
    return Math.sqrt((1 + 0.5 * srDaily * srDaily) / n) * Math.sqrt(tradingDaysPerYear);
}

export function beta(portfolioReturns: number[], benchmarkReturns: number[]): number {
    const benchVariance = variance(benchmarkReturns);
    if (!Number.isFinite(benchVariance) || benchVariance < MIN_VARIANCE) return 0;
    return covariance(portfolioReturns, benchmarkReturns) / benchVariance;
  }

  export function alpha(
    portfolioAnnualReturn: number,
    benchmarkAnnualReturn: number,
    riskFreeAnnualRate: number,
    betaValue: number
  ): number {
    return portfolioAnnualReturn - (riskFreeAnnualRate + betaValue * (benchmarkAnnualReturn - riskFreeAnnualRate));
  }


  export function maxDrawdown(series: DailyValue[]): number {
    let peak = -Infinity;
    let maxDD = 0;
    for (const point of series) {
      if (point.value > peak) peak = point.value;
      const drawdown = (point.value - peak) / peak;
      if (drawdown < maxDD) maxDD = drawdown;
    }
    return maxDD; // e.g. -0.23 means -23%
  }

  export function compositeBenchmarkReturns(
    klciReturns: number[],
    sp500Returns: number[],
    bursaWeight: number, // e.g. 0.6 if 60% of portfolio value is Bursa
    usWeight: number
  ): number[] {
    return klciReturns.map((r, i) => r * bursaWeight + sp500Returns[i] * usWeight);
  }

export function indexTo100(series: DailyValue[]): {date: string; indexedValue: number}[] {
    if (series.length === 0) return [];
    const start = series[0].value;
    if (start <= 0) return series.map((point) => ({date: point.date, indexedValue: 100}));
    return series.map((point) => ({
        date: point.date,
        indexedValue: (point.value / start) * 100,
    }));
}

/**
 * Index starting at 100. `cashFlowByDate` is money in (+) / out (−) on that
 * date, which is removed so deposits do not read as performance.
 * `incomeByDate` is dividend cash going ex on that date: NAV drops by it, but
 * the money is still the portfolio's, so it is added back.
 */
export function timeWeightedIndex(
    values: DailyValue[],
    cashFlowByDate: Map<string, number>,
    incomeByDate: Map<string, number> = new Map()
): DailyValue[] {
    if (values.length === 0) return [];
    const out: DailyValue[] = [{date: values[0].date, value: 100}];
    let indexed = 100;
    for (let i = 1; i < values.length; i++) {
        const prev = values[i - 1].value;
        const curr = values[i].value;
        const cashFlow = cashFlowByDate.get(values[i].date) ?? 0;
        const income = incomeByDate.get(values[i].date) ?? 0;
        const dailyReturn = prev > 1e-6 ? (curr - prev - cashFlow + income) / prev : 0;
        indexed *= 1 + dailyReturn;
        out.push({date: values[i].date, value: indexed});
    }
    return out;
}