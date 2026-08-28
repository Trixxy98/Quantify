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
import {currencyFromSymbol} from "./market.service";
import {getOwnedPortfolio} from "./portfolio.service";
import {markOpenPositions} from "./valuation.service";
import {type Range, resolveRangeStart, toDateKey} from "../utils/dateRange";

export type {Range};

const BURSA_BENCHMARK = "^KLSE";
const US_BENCHMARK = "^GSPC";

async function loadSnapshotSeries(portfolioId: string, range: Range): Promise<DailyValue[]> {
    const start = resolveRangeStart(range);
    const snapshots = await prisma.portfolioSnapshot.findMany({
        where: {portfolioId, ...(start ? {date: {gte: start}} : {})},
        orderBy: {date: "asc"},
    });
    return snapshots.map((s) => ({date: toDateKey(s.date), value: Number(s.totalValue)}));
}

async function getBenchmarkWeights(portfolioId: string, baseCurrency: Currency) {
    const values = await markOpenPositions(portfolioId, baseCurrency);
    const priced = values.filter((v) => v.marketValue != null);
    const total = priced.reduce((sum, v) => sum + v.marketValue!, 0);
    if (total === 0) return {bursa: 1, us: 0};

    const bursa = priced
        .filter((v) => v.exchange === Exchange.BURSA)
        .reduce((sum, v) => sum + v.marketValue!, 0) / total;

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
    const marks = await markOpenPositions(portfolioId, portfolio.baseCurrency);
    const priced = marks.filter((m) => m.marketValue != null);

    const snapshots = await prisma.portfolioSnapshot.findMany({
        where: {portfolioId},
        orderBy: {date: "desc"},
        take: 8,
    });

    if (priced.length === 0) {
        const current = snapshots[0];
        if (!current) {
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
        const totalValue = Number(current.totalValue);
        const totalCost = Number(current.totalCost);
        const prevValue = snapshots[1] ? Number(snapshots[1].totalValue) : totalValue;
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

    const totalValue = priced.reduce((sum, m) => sum + m.marketValue!, 0);
    const totalCost = priced.reduce((sum, m) => sum + m.baseCost, 0);
    const asOfDate = priced.reduce<string | null>((max, m) => {
        if (!m.lastPriceDate) return max;
        const key = toDateKey(m.lastPriceDate);
        return !max || key > max ? key : max;
    }, null);

    const asOfTime = asOfDate ? Date.parse(`${asOfDate}T00:00:00.000Z`) : NaN;
    const prev = snapshots.find((s) => (Number.isNaN(asOfTime) ? true : s.date.getTime() < asOfTime));
    const prevValue = prev ? Number(prev.totalValue) : totalValue;

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
        asOfDate,
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
    const marks = await markOpenPositions(portfolioId, portfolio.baseCurrency);
    const priced = marks.filter((m) => m.marketValue != null);
    const totalValue = priced.reduce((sum, m) => sum + m.marketValue!, 0);
    return {
        totalValue,
        items: priced
            .map((m) => ({
                symbol: m.symbol,
                exchange: m.exchange,
                marketValue: m.marketValue!,
                percentage: totalValue > 0 ? m.marketValue! / totalValue : 0,
            }))
            .sort((a, b) => b.marketValue - a.marketValue),
    };
}

export async function getPriceSeries(
    portfolioId: string,
    userId: string,
    rawSymbol: string,
    range: Range
) {
    await getOwnedPortfolio(portfolioId, userId);
    const symbol = rawSymbol.toUpperCase();

    const inPortfolio =
        (await prisma.holding.findFirst({where: {portfolioId, symbol}})) ??
        (await prisma.transaction.findFirst({where: {portfolioId, symbol}}));
    if (!inPortfolio) {
        throw new AppError(404, "NOT_FOUND", "Symbol not found in this portfolio");
    }

    const start = resolveRangeStart(range);
    const prices = await prisma.dailyPrice.findMany({
        where: {symbol, ...(start ? {date: {gte: start}} : {})},
        orderBy: {date: "asc"},
    });

    return {
        symbol,
        currency: prices[0] ? prices[0].currency : currencyFromSymbol(symbol),
        range,
        series: prices.map((p) => ({date: toDateKey(p.date), close: Number(p.close)})),
    };
}

