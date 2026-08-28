import {Currency, Exchange, TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {covariance, variance} from "../utils/stats.util";
import {type Range, resolveRangeStart, toDateKey} from "../utils/dateRange";
import {latestAtOrBefore, loadUsdMyrSeries, toBase, type SeriesPoint} from "./fx";
import {currencyFromSymbol} from "./market.service";
import {getOwnedPortfolio} from "./portfolio.service";
import {markOpenPositions} from "./valuation.service";

const BURSA_BENCHMARK = "^KLSE";
const US_BENCHMARK = "^GSPC";
const MIN_BETA_OBS = 10;
const MIN_RISK_OBS = 5;
const BETA_MIN = -2;
const BETA_MAX = 3;

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

function exchangeFromSymbol(symbol: string): Exchange {
    return symbol.toUpperCase().endsWith(".KL") ? Exchange.BURSA : Exchange.US;
}

function fxSensitivity(currency: Currency, base: Currency): number {
    if (currency === base) return 0;
    if (base === Currency.MYR && currency === Currency.USD) return 1;
    if (base === Currency.USD && currency === Currency.MYR) return -1;
    return 0;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function applyTx(qty: Map<string, number>, type: TransactionType, symbol: string, quantity: number) {
    const current = qty.get(symbol) ?? 0;
    const next = type === TransactionType.BUY ? current + quantity : current - quantity;
    qty.set(symbol, next <= 1e-9 ? 0 : next);
}

function priceAt(series: SeriesPoint[] | undefined, time: number): number | null {
    if (!series || series.length === 0) return null;
    return latestAtOrBefore(series, time);
}

function computeBeta(stock: SeriesPoint[], bench: SeriesPoint[], startTime: number): number {
    const rStock: number[] = [];
    const rBench: number[] = [];

    for (let i = 1; i < stock.length; i++) {
        if (stock[i].date < startTime) continue;
        const p0 = stock[i - 1].close;
        const p1 = stock[i].close;
        const b0 = latestAtOrBefore(bench, stock[i - 1].date);
        const b1 = latestAtOrBefore(bench, stock[i].date);
        if (p0 > 0 && b0 != null && b1 != null && b0 > 0) {
            rStock.push((p1 - p0) / p0);
            rBench.push((b1 - b0) / b0);
        }
    }

    if (rStock.length < MIN_BETA_OBS) return 1;
    const v = variance(rBench);
    if (!Number.isFinite(v) || v < 1e-12) return 1;
    return clamp(covariance(rStock, rBench) / v, BETA_MIN, BETA_MAX);
}

export async function getAnalysis(
    portfolioId: string,
    userId: string,
    range: Range
): Promise<PortfolioAnalysis> {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const base = portfolio.baseCurrency;
    const marks = await markOpenPositions(portfolioId, base);
    const priced = marks.filter((m) => m.marketValue != null);
    const totalValue = priced.reduce((sum, m) => sum + m.marketValue!, 0);
    const asOf = priced.reduce<string | null>((max, m) => {
        if (!m.lastPriceDate) return max;
        const key = toDateKey(m.lastPriceDate);
        return !max || key > max ? key : max;
    }, null);

    const empty = (positions: ScenarioPosition[], items: AttributionItem[] = []): PortfolioAnalysis => ({
        range,
        asOf,
        baseCurrency: base,
        days: 0,
        totalValue,
        totalContribution: 0,
        stockContribution: 0,
        fxContribution: 0,
        items,
        scenario: {totalValue, positions},
    });

    const transactions = await prisma.transaction.findMany({
        where: {portfolioId},
        orderBy: [{date: "asc"}, {createdAt: "asc"}],
    });
    if (transactions.length === 0) {
        return empty([]);
    }

    const symbols = [...new Set(transactions.map((t) => t.symbol))];
    const start = resolveRangeStart(range);
    const startTime = start ? start.getTime() : 0;

    const [prices, fxSeries, benchmarks] = await Promise.all([
        prisma.dailyPrice.findMany({
            where: {symbol: {in: symbols}},
            orderBy: {date: "asc"},
        }),
        loadUsdMyrSeries(),
        prisma.benchmarkPrice.findMany({
            where: {symbol: {in: [BURSA_BENCHMARK, US_BENCHMARK]}},
            orderBy: {date: "asc"},
        }),
    ]);

    const priceMap = new Map<string, SeriesPoint[]>();
    const calendarSet = new Set<number>();
    for (const p of prices) {
        const time = p.date.getTime();
        calendarSet.add(time);
        if (!priceMap.has(p.symbol)) priceMap.set(p.symbol, []);
        priceMap.get(p.symbol)!.push({date: time, close: Number(p.close)});
    }
    const calendar = [...calendarSet].sort((a, b) => a - b);

    const klci: SeriesPoint[] = [];
    const spx: SeriesPoint[] = [];
    for (const row of benchmarks) {
        const point = {date: row.date.getTime(), close: Number(row.close)};
        if (row.symbol === BURSA_BENCHMARK) klci.push(point);
        else spx.push(point);
    }

    const betaBySymbol = new Map<string, number>();
    for (const symbol of symbols) {
        const series = priceMap.get(symbol) ?? [];
        const bench = exchangeFromSymbol(symbol) === Exchange.BURSA ? klci : spx;
        betaBySymbol.set(symbol, computeBeta(series, bench, startTime));
    }

    const scenarioPositions: ScenarioPosition[] = priced.map((m) => ({
        symbol: m.symbol,
        exchange: m.exchange,
        marketValue: m.marketValue!,
        beta: betaBySymbol.get(m.symbol) ?? 1,
        fxSensitivity: fxSensitivity(m.currency, base),
    }));

    if (calendar.length < 2) {
        return empty(scenarioPositions);
    }

    const qty = new Map<string, number>();
    let txIndex = 0;
    while (txIndex < transactions.length && transactions[txIndex].date.getTime() < calendar[0]) {
        const t = transactions[txIndex];
        applyTx(qty, t.type, t.symbol, Number(t.quantity));
        txIndex++;
    }

    const stockBy = new Map<string, number>();
    const fxBy = new Map<string, number>();
    const contribDays: number[][] = [];
    const symbolIndex = new Map(symbols.map((s, i) => [s, i]));
    let prevTime: number | null = null;

    function bump(map: Map<string, number>, symbol: string, amount: number) {
        map.set(symbol, (map.get(symbol) ?? 0) + amount);
    }

    for (const time of calendar) {
        if (prevTime != null && time >= startTime) {
            const day = symbols.map(() => 0);
            let portPrev = 0;
            const pnls: {symbol: string; pnl: number}[] = [];

            for (const symbol of symbols) {
                const q = qty.get(symbol) ?? 0;
                if (q <= 1e-9) continue;
                const p0 = priceAt(priceMap.get(symbol), prevTime);
                const p1 = priceAt(priceMap.get(symbol), time);
                const ccy = currencyFromSymbol(symbol);
                const fx0 = toBase(1, ccy, base, fxSeries, prevTime);
                const fx1 = toBase(1, ccy, base, fxSeries, time);
                if (p0 == null || p1 == null || fx0 == null || fx1 == null) continue;

                portPrev += q * p0 * fx0;
                const dP = p1 - p0;
                const dFx = fx1 - fx0;
                const stockPart = q * dP * fx0;
                const fxPart = q * p0 * dFx + q * dP * dFx;
                bump(stockBy, symbol, stockPart);
                bump(fxBy, symbol, fxPart);
                pnls.push({symbol, pnl: stockPart + fxPart});
            }

            if (portPrev > 1e-6) {
                for (const {symbol, pnl} of pnls) {
                    day[symbolIndex.get(symbol)!] = pnl / portPrev;
                }
                contribDays.push(day);
            }
        }

        while (txIndex < transactions.length && transactions[txIndex].date.getTime() <= time) {
            const t = transactions[txIndex];
            applyTx(qty, t.type, t.symbol, Number(t.quantity));
            txIndex++;
        }
        prevTime = time;
    }

    const days = contribDays.length;
    let riskShareBy = new Map<string, number>();
    if (days >= MIN_RISK_OBS) {
        const rp = contribDays.map((day) => day.reduce((s, v) => s + v, 0));
        const varP = variance(rp);
        if (Number.isFinite(varP) && varP > 1e-16) {
            for (const symbol of symbols) {
                const i = symbolIndex.get(symbol)!;
                const c = contribDays.map((day) => day[i]);
                riskShareBy.set(symbol, covariance(c, rp) / varP);
            }
        }
    }

    const mvBy = new Map(priced.map((m) => [m.symbol, m.marketValue ?? null]));
    const shown = new Set<string>([
        ...priced.map((m) => m.symbol),
        ...[...stockBy.keys()],
        ...[...fxBy.keys()],
    ]);

    const items: AttributionItem[] = [...shown]
        .map((symbol) => {
            const stockContribution = stockBy.get(symbol) ?? 0;
            const fxContribution = fxBy.get(symbol) ?? 0;
            const contribution = stockContribution + fxContribution;
            const marketValue = mvBy.get(symbol) ?? null;
            const exchange = exchangeFromSymbol(symbol);
            const currency = currencyFromSymbol(symbol);
            const weight = totalValue > 0 && marketValue != null ? marketValue / totalValue : 0;
            const riskShare = riskShareBy.get(symbol) ?? weight;
            return {
                symbol,
                exchange,
                currency,
                marketValue,
                weight,
                contribution,
                contributionShare: 0,
                stockContribution,
                fxContribution,
                riskShare,
                beta: betaBySymbol.get(symbol) ?? 1,
            };
        })
        .filter((row) => row.marketValue != null || Math.abs(row.contribution) > 0.005)
        .sort((a, b) => b.contribution - a.contribution);

    const totalContribution = items.reduce((s, r) => s + r.contribution, 0);
    const stockContribution = items.reduce((s, r) => s + r.stockContribution, 0);
    const fxContribution = items.reduce((s, r) => s + r.fxContribution, 0);
    for (const row of items) {
        row.contributionShare = totalContribution !== 0 ? row.contribution / totalContribution : 0;
    }

    return {
        range,
        asOf,
        baseCurrency: base,
        days,
        totalValue,
        totalContribution,
        stockContribution,
        fxContribution,
        items,
        scenario: {totalValue, positions: scenarioPositions},
    };
}
