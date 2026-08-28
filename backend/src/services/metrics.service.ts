import { average, stdDev, variance, covariance } from "../utils/stats.util";

export type DailyValue = {date: string; value: number};

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
    const totalCompounded = dailyReturns.reduce((acc, r) => acc * (1 + r), 1);
    const years = dailyReturns.length / tradingDaysPerYear;
    return Math.pow(totalCompounded, 1 / years) -1;
}

export function cagr(startValue: number, endValue: number, years: number): number {
    return Math.pow(endValue / startValue, 1 / years) -1;
}

export function volatility(dailyReturns: number[], tradingDaysPerYear = 252): number {
    return stdDev(dailyReturns) * Math.sqrt(tradingDaysPerYear);
  }

  export function sharpeRatio(dailyReturns: number[], riskFreeAnnualRate: number, tradingDaysPerYear = 252): number {
    const rfDaily = riskFreeAnnualRate / tradingDaysPerYear;   
    const excessReturns = dailyReturns.map((r) => r - rfDaily);
    const std = stdDev(excessReturns);
    if (std === 0) return 0;
    return (average(excessReturns) / std) * Math.sqrt(tradingDaysPerYear);
}

export function beta(portfolioReturns: number[], benchmarkReturns: number[]): number {
    return covariance(portfolioReturns, benchmarkReturns) / variance(benchmarkReturns);
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