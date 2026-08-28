import {Currency, Exchange} from "@prisma/client";
import {env} from "../config/env";
import {prisma} from "../lib/prisma";
import {AppError} from "../utils/AppError";
import {
    DailyValue,
    alpha,
    annualizedReturn,
    beta,
    cagr,
    compositeBenchmarkReturns,
    maxDrawdown,
    sharpeRatio,
    toDailyReturns,
    volatility,
} from "./metrics.service";
import {getOwnedPortfolio} from "./portfolio.service";

const BURSA_BENCHMARK = "^KLSE";
const US_BENCHMARK = "^GSPC";

export type Range = "1M" | "3M" | "6M" | "1Y" | "YTD" | "ALL";

function addUtcMonths(date: Date, months: number): Date {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const rawMonth = month + months;
    const targetYear = year + Math.floor(rawMonth / 12);
    const targetMonth = ((rawMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

function resolveRangeStart(range: Range): Date | null {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    switch (range) {
        case "1M": return addUtcMonths(d, -1);
        case "3M": return addUtcMonths(d, -3);
        case "6M": return addUtcMonths(d, -6);
        case "1Y": d.setUTCFullYear(d.getUTCFullYear() - 1); return d;
        case "YTD": return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        case "ALL": return null;
    }
}

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

async function loadSnapshotSeries(portfolioId: string, range: Range): Promise<DailyValue[]> {
    const start = resolveRangeStart(range);
    const snapshots = await prisma.portfolioSnapshot.findMany({
        where: {portfolioId, ...(start ? {date: {gte: start}} : {})},
        orderBy: {date: "asc"},
    });
    return snapshots.map((s) => ({date: toDateKey(s.date), value: Number(s.totalValue)}));
}

// Current market value of each holding, in baseCurrency
async function getHoldingValues(portfolioId: string, baseCurrency: Currency) {
    const holdings = await prisma.holding.findMany({where: {portfolioId}});

    const latestFx = await prisma.exchangeRate.findFirst({
        where: {from: Currency.USD, to: Currency.MYR},
        orderBy: {date: "desc"},
    });
    const usdMyr = latestFx ? Number(latestFx.rate) : null;

    const values: {symbol: string; exchange: Exchange; marketValue: number }[] = [];
    
    for (const holding of holdings) {
        const lastPrice = await prisma.dailyPrice.findFirst({
            where: {symbol: holding.symbol},
            orderBy: {date: "desc"},
        });
        if (!lastPrice) continue;

        let marketValue = Number(holding.quantity) * Number(lastPrice.close);

        if (holding.currency !== baseCurrency) {
            if (usdMyr == null) continue; // no FX rate
            marketValue = holding.currency === Currency.USD ? marketValue * usdMyr : marketValue / usdMyr;
        }

        values.push({symbol: holding.symbol, exchange: holding.exchange, marketValue});
    }

    return values;
}

async function getBenchmarkWeights(portfolioId: string, baseCurrency: Currency) {
    const values = await getHoldingValues(portfolioId, baseCurrency);
    const total = values.reduce((sum, v) => sum + v.marketValue, 0);
    if (total === 0) return {bursa: 1, us: 0};

    const bursa = values
        .filter((v) => v.exchange === Exchange.BURSA)
        .reduce((sum, v) => sum + v.marketValue, 0) / total;

    return {bursa, us: 1 - bursa};
}

async function loadAlignedBenchmark(
    portfolioSeries: DailyValue[],
    weights: {bursa: number; us: number},
    range: Range
) {
    const start = resolveRangeStart(range);
    const rows = await prisma.benchmarkPrice.findMany({
        where: {
            symbol: {in: [BURSA_BENCHMARK, US_BENCHMARK]},
            ...(start ? {date: {gte: start}} : {}),
        },
        orderBy: {date: "asc"},
    });

    const klse = new Map<string, number>();
    const gspc = new Map<string, number>();
    for (const row of rows) {
        const key = toDateKey(row.date);
        (row.symbol === BURSA_BENCHMARK ? klse : gspc).set(key, Number(row.close));
    }

    const pSeries: DailyValue[] = [];
    const kSeries: DailyValue[] = [];
    const gSeries: DailyValue[] = [];

    for (const point of portfolioSeries) {
        const k = klse.get(point.date);
        const g = gspc.get(point.date);

        if (weights.bursa > 0 && k == null) continue;
        if (weights.us > 0 && g == null) continue;

        pSeries.push(point);
        kSeries.push({date: point.date, value: k ?? 1});
        gSeries.push({date: point.date, value: g ?? 1});
    }

    return {pSeries, kSeries, gSeries};
}

export async function getSummary(portfolioId: string, userId: string) {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);

    const latest = await prisma.portfolioSnapshot.findMany({
        where: {portfolioId},
        orderBy: {date: "desc"},
        take: 2,
    });

    if (latest.length === 0) {
        return {
            portfolioId,
            name: portfolio.name,
            baseCurrency: portfolio.baseCurrency,
            totalValue: 0,
            totalCost: 0,
            unrealizedPnL: 0,
            unrealizedPnLPct: 0,
            todayReturnPct: 0,
            todayReturnValue: 0,
            asOfDate: null,
        };
    }

    const current = latest[0];
    const totalValue = Number(current.totalValue);
    const totalCost = Number(current.totalCost);
    const prevValue = latest[1] ? Number(latest[1].totalValue) : totalValue;

    return {
        portfolioId, 
        name: portfolio.name,
        baseCurrency: portfolio.baseCurrency,
        totalValue,
        totalCost,
        unrealizedPnL: totalValue - totalCost,
        unrealizedPnLPct: totalCost > 0 ? (totalValue - totalCost) / totalCost : 0,
        todayReturnPct: prevValue > 0 ? (totalValue - prevValue) / prevValue : 0,
        todayReturnValue: totalValue - prevValue,
        asOfDate: toDateKey(current.date),
    };
}

export async function getMetrics(portfolioId: string, userId: string, range: Range) {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const series = await loadSnapshotSeries(portfolioId, range);

    if (series.length < 3) {
        throw new AppError(
            422,
            "INSUFFICIENT_DATA",
            "Not enough snapshot data for this range - run a sync and try again"
        );
    }

    const dailyReturns = toDailyReturns(series);
    const riskFree = env.RISK_FREE_RATE;
    const portfolioAnnual = annualizedReturn(dailyReturns);

    const startTime = new Date(series[0].date).getTime();
    const endTime = new Date(series[series.length - 1].date).getTime();
    const years = (endTime - startTime) / (365.25 * 24 * 60 * 60 * 1000);

    const weights = await getBenchmarkWeights(portfolioId, portfolio.baseCurrency);
    const {pSeries, kSeries, gSeries} = await loadAlignedBenchmark(series, weights, range);

    let betaValue = 0;
    let alphaValue = 0;
    if (pSeries.length >= 3) {
        const pReturns = toDailyReturns(pSeries);
        const benchReturns = compositeBenchmarkReturns(
            toDailyReturns(kSeries),
            toDailyReturns(gSeries),
            weights.bursa,
            weights.us
        );
        betaValue = beta(pReturns, benchReturns);
        alphaValue = alpha(portfolioAnnual, annualizedReturn(benchReturns), riskFree, betaValue);
    }

    return {
        range,
        asOf: series[series.length - 1].date,
        annualReturn: portfolioAnnual,
        cagr: years > 0 ? cagr(series[0].value, series[series.length - 1].value, years) : 0,
        volatility: volatility(dailyReturns),
        sharpeRatio: sharpeRatio(dailyReturns, riskFree),
        beta: betaValue,
        alpha: alphaValue,
        maxDrawdown: maxDrawdown(series),
    };
}

export async function getPerformance(portfolioId: string, userId: string, range: Range) {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const series = await loadSnapshotSeries(portfolioId, range);

    if (series.length === 0) {
        return {range, series: [], benchmarkSeries: []};
    }

    const weights = await getBenchmarkWeights(portfolioId, portfolio.baseCurrency);
    const {pSeries, kSeries, gSeries} = await loadAlignedBenchmark(series, weights, range);

    const benchmarkSeries: {date: string; indexedValue: number}[] = [];
    if (pSeries.length >= 2) {
        const benchReturns = compositeBenchmarkReturns(
            toDailyReturns(kSeries),
            toDailyReturns(gSeries),
            weights.bursa,
            weights.us
        );

        let indexed = 100;
        benchmarkSeries.push({date: pSeries[0].date, indexedValue: 100});
        for (let i = 0; i < benchReturns.length; i++) {
            indexed *= 1 + benchReturns[i];
            benchmarkSeries.push({date: pSeries[i + 1].date, indexedValue: indexed});
        }
    }
    return {range, series, benchmarkSeries};
}

export async function getAllocation(portfolioId: string, userId: string) {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const values = await getHoldingValues(portfolioId, portfolio.baseCurrency);
    const totalValue = values.reduce((sum, v) => sum + v.marketValue, 0);
    return {
        totalValue,
        items: values
            .map((v) => ({
                symbol: v.symbol,
                exchange: v.exchange,
                marketValue: v.marketValue,
                percentage: totalValue > 0 ? v.marketValue / totalValue : 0,
            }))
            .sort((a, b) => b.marketValue - a.marketValue),
    };
}

