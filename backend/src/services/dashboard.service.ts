import {Currency, Exchange, TransactionType} from "@prisma/client";
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
    indexTo100,
    maxDrawdown,
    sharpeRatio,
    sharpeStandardError,
    timeWeightedIndex,
    toDailyReturns,
    volatility,
} from "./metrics.service";
import {currencyFromSymbol} from "./market.service";
import {getOwnedPortfolio} from "./portfolio.service";
import {markOpenPositions} from "./valuation.service";
import {realizePortfolio} from "./lots.service";
import {latestAtOrBefore, loadUsdMyrSeries, toBase} from "./fx";
import {type Range, resolveRangeStart, toDateKey} from "../utils/dateRange";

export type {Range};

const BURSA_BENCHMARK = "^KLSE";
const US_TOTAL_RETURN = "^SP500TR";
const US_PRICE_INDEX = "^GSPC";

// Sharpe/vol/beta below this many observations are noise, not estimates
const LOW_CONFIDENCE_OBSERVATIONS = 60;

type SnapshotRow = {date: string; value: number; income: number};

async function loadSnapshots(portfolioId: string, range: Range): Promise<SnapshotRow[]> {
    const start = resolveRangeStart(range);
    const snapshots = await prisma.portfolioSnapshot.findMany({
        where: {portfolioId, ...(start ? {date: {gte: start}} : {})},
        orderBy: {date: "asc"},
    });
    return snapshots.map((s) => ({
        date: toDateKey(s.date),
        value: Number(s.totalValue),
        income: Number(s.dividendIncome),
    }));
}

function toNav(rows: SnapshotRow[]): DailyValue[] {
    return rows.map((row) => ({date: row.date, value: row.value}));
}

function toIncomeMap(rows: SnapshotRow[]): Map<string, number> {
    return new Map(rows.map((row) => [row.date, row.income]));
}

/**
 * Prefer the total-return index, but a database that has not been synced since
 * ^SP500TR was added still has to produce a chart. Never mix the two: their
 * levels differ, so switching mid-series would invent a return.
 */
async function resolveUsBenchmark(): Promise<string> {
    const [totalReturn, priceIndex] = await Promise.all([
        prisma.benchmarkPrice.count({where: {symbol: US_TOTAL_RETURN}}),
        prisma.benchmarkPrice.count({where: {symbol: US_PRICE_INDEX}}),
    ]);
    return totalReturn > 0 && totalReturn >= priceIndex * 0.9 ? US_TOTAL_RETURN : US_PRICE_INDEX;
}

/**
 * The one place that turns NAV into a return series: strips deposits and
 * withdrawals, adds dividends back. Both the metric cards and the performance
 * chart read from this so they cannot drift apart.
 */
async function buildTwrSeries(
    portfolioId: string,
    baseCurrency: Currency,
    rows: SnapshotRow[]
): Promise<DailyValue[]> {
    const nav = toNav(rows);
    const cashFlows = await cashFlowBySnapshotDate(portfolioId, baseCurrency, nav);
    return timeWeightedIndex(nav, cashFlows, toIncomeMap(rows));
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
    range: Range,
    usBenchmark: string
) {
    const start = resolveRangeStart(range);
    const rows = await prisma.benchmarkPrice.findMany({
        where: {
            symbol: {in: [BURSA_BENCHMARK, usBenchmark]},
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

async function loadBenchmarkLevels(dates: string[], usBenchmark: string) {
    const rows = await prisma.benchmarkPrice.findMany({
        where: {symbol: {in: [BURSA_BENCHMARK, usBenchmark]}},
        orderBy: {date: "asc"},
    });

    const klciPoints = rows
        .filter((row) => row.symbol === BURSA_BENCHMARK)
        .map((row) => ({date: row.date.getTime(), close: Number(row.close)}));
    const spxPoints = rows
        .filter((row) => row.symbol === usBenchmark)
        .map((row) => ({date: row.date.getTime(), close: Number(row.close)}));

    const klci: DailyValue[] = [];
    const spx: DailyValue[] = [];
    let lastKlci: number | null = null;
    let lastSpx: number | null = null;

    for (const date of dates) {
        const time = Date.parse(`${date}T00:00:00.000Z`);
        lastKlci = latestAtOrBefore(klciPoints, time) ?? lastKlci;
        lastSpx = latestAtOrBefore(spxPoints, time) ?? lastSpx;
        if (lastKlci != null) klci.push({date, value: lastKlci});
        if (lastSpx != null) spx.push({date, value: lastSpx});
    }
    return {klci, spx};
}

async function cashFlowBySnapshotDate(
    portfolioId: string,
    baseCurrency: Currency,
    snapshots: DailyValue[]
): Promise<Map<string, number>> {
    const flows = new Map<string, number>();
    if (snapshots.length < 2) return flows;

    const [transactions, fxSeries] = await Promise.all([
        prisma.transaction.findMany({
            where: {portfolioId},
            orderBy: [{date: "asc"}, {createdAt: "asc"}],
        }),
        loadUsdMyrSeries(),
    ]);

    const firstTime = Date.parse(`${snapshots[0].date}T00:00:00.000Z`);
    let txIndex = 0;
    while (txIndex < transactions.length && transactions[txIndex].date.getTime() <= firstTime) {
        txIndex++;
    }

    for (let i = 1; i < snapshots.length; i++) {
        const time = Date.parse(`${snapshots[i].date}T00:00:00.000Z`);
        let cashFlow = 0;
        while (txIndex < transactions.length && transactions[txIndex].date.getTime() <= time) {
            const t = transactions[txIndex];
            const qty = Number(t.quantity);
            const native =
                t.type === TransactionType.BUY
                    ? qty * Number(t.price) + Number(t.fee)
                    : -(qty * Number(t.price) - Number(t.fee));
            const base = toBase(native, t.currency, baseCurrency, fxSeries, t.date.getTime());
            if (base != null) cashFlow += base;
            txIndex++;
        }
        flows.set(snapshots[i].date, cashFlow);
    }

    return flows;
}

async function realizedTotals(portfolioId: string, baseCurrency: Currency) {
    const {sells, lots} = await realizePortfolio(portfolioId, baseCurrency);
    const realizedPnL = [...sells.values()].reduce((sum, row) => sum + row.realizedPnLBase, 0);
    const realizedCost = [...sells.values()].reduce((sum, row) => sum + row.costBase, 0);
    return {
        realizedPnL,
        realizedPnLPct: realizedCost > 0 ? realizedPnL / realizedCost : 0,
        closedLotCount: lots.length,
    };
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

    const realized = await realizedTotals(portfolioId, portfolio.baseCurrency);

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
                realizedPnL: realized.realizedPnL,
                realizedPnLPct: realized.realizedPnLPct,
                totalPnL: realized.realizedPnL,
                closedLotCount: realized.closedLotCount,
                todayReturnPct: 0,
                todayReturnValue: 0,
                asOfDate: null,
            };
        }
        const totalValue = Number(current.totalValue);
        const totalCost = Number(current.totalCost);
        const prevValue = snapshots[1] ? Number(snapshots[1].totalValue) : totalValue;
        const unrealizedPnL = totalValue - totalCost;
        return {
            portfolioId,
            name: portfolio.name,
            baseCurrency: portfolio.baseCurrency,
            totalValue,
            totalCost,
            unrealizedPnL,
            unrealizedPnLPct: totalCost > 0 ? unrealizedPnL / totalCost : 0,
            realizedPnL: realized.realizedPnL,
            realizedPnLPct: realized.realizedPnLPct,
            totalPnL: unrealizedPnL + realized.realizedPnL,
            closedLotCount: realized.closedLotCount,
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
    const unrealizedPnL = totalValue - totalCost;

    return {
        portfolioId,
        name: portfolio.name,
        baseCurrency: portfolio.baseCurrency,
        totalValue,
        totalCost,
        unrealizedPnL,
        unrealizedPnLPct: totalCost > 0 ? unrealizedPnL / totalCost : 0,
        realizedPnL: realized.realizedPnL,
        realizedPnLPct: realized.realizedPnLPct,
        totalPnL: unrealizedPnL + realized.realizedPnL,
        closedLotCount: realized.closedLotCount,
        todayReturnPct: prevValue > 0 ? (totalValue - prevValue) / prevValue : 0,
        todayReturnValue: totalValue - prevValue,
        asOfDate,
    };
}

export async function getMetrics(portfolioId: string, userId: string, range: Range) {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const rows = await loadSnapshots(portfolioId, range);

    if (rows.length < 3) {
        throw new AppError(
            422,
            "INSUFFICIENT_DATA",
            "Not enough snapshot data for this range - run a sync and try again"
        );
    }

    // Risk describes the strategy, not the funding. Measuring on raw NAV would
    // read every deposit as a gain and every withdrawal as a drawdown, so
    // everything below runs on the cash-flow adjusted, dividend-inclusive series.
    const twr = await buildTwrSeries(portfolioId, portfolio.baseCurrency, rows);
    const dailyReturns = toDailyReturns(twr);
    const riskFree = env.RISK_FREE_RATE;
    const portfolioAnnual = annualizedReturn(dailyReturns);

    const startTime = new Date(rows[0].date).getTime();
    const endTime = new Date(rows[rows.length - 1].date).getTime();
    const years = (endTime - startTime) / (365.25 * 24 * 60 * 60 * 1000);

    const weights = await getBenchmarkWeights(portfolioId, portfolio.baseCurrency);
    const usBenchmark = await resolveUsBenchmark();
    const {pSeries, kSeries, gSeries} = await loadAlignedBenchmark(
        twr,
        weights,
        range,
        usBenchmark
    );

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
        asOf: rows[rows.length - 1].date,
        annualReturn: portfolioAnnual,
        cagr: cagr(twr[0].value, twr[twr.length - 1].value, years),
        volatility: volatility(dailyReturns),
        sharpeRatio: sharpeRatio(dailyReturns, riskFree),
        sharpeStandardError: sharpeStandardError(dailyReturns, riskFree),
        beta: betaValue,
        alpha: alphaValue,
        maxDrawdown: maxDrawdown(twr),
        dividendIncome: rows.reduce((sum, row) => sum + row.income, 0),
        observations: dailyReturns.length,
        isLowConfidence: dailyReturns.length < LOW_CONFIDENCE_OBSERVATIONS,
        usBenchmark,
    };
}

export async function getPerformance(portfolioId: string, userId: string, range: Range) {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const rows = await loadSnapshots(portfolioId, range);

    if (rows.length === 0) {
        return {range, series: [], benchmarkSeries: [], klciSeries: [], spxSeries: []};
    }

    const nav = toNav(rows);
    const weights = await getBenchmarkWeights(portfolioId, portfolio.baseCurrency);
    const usBenchmark = await resolveUsBenchmark();
    const {pSeries, kSeries, gSeries} = await loadAlignedBenchmark(
        nav,
        weights,
        range,
        usBenchmark
    );
    const {klci, spx} = await loadBenchmarkLevels(
        nav.map((point) => point.date),
        usBenchmark
    );
    const series = await buildTwrSeries(portfolioId, portfolio.baseCurrency, rows);

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

    return {
        range,
        series,
        benchmarkSeries,
        klciSeries: indexTo100(klci),
        spxSeries: indexTo100(spx),
        usBenchmark,
    };
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

