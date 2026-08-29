import YahooFinance from "yahoo-finance2";
import {Currency} from "@prisma/client";
import {prisma} from "../lib/prisma";

// v3: default export is a class — instantiate first
export const yahooFinance = new YahooFinance();

export const BENCHMARK_SYMBOLS = ["^KLSE", "^GSPC"];
const USD_MYR_SYMBOL = "MYR=X";

export function currencyFromSymbol(symbol: string): Currency {
    return symbol.toUpperCase().endsWith(".KL") ? Currency.MYR : Currency.USD;
}

// Normalize to UTC midnight — use UTC getters so US session close (20:00 UTC)
// does not roll into the next calendar day on a MYT server
function toUtcDate(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function fetchDailyBars(symbol: string, from: Date) {
    const result = await yahooFinance.chart(symbol, {
        period1: from,
        interval: "1d",
    });
    return result.quotes.filter((q) => q.close != null);
}

export async function getTrackedSymbols(): Promise<string[]> {
    const holdings = await prisma.holding.findMany({
        select: {symbol: true},
        distinct: ["symbol"],
    });
    return holdings.map((h) => h.symbol);
}

export async function syncDailyPrices(symbol: string, from: Date) {
    const bars = await fetchDailyBars(symbol, from);
    const currency = currencyFromSymbol(symbol);
    const fromDate = toUtcDate(from);

    await prisma.$transaction([
        prisma.dailyPrice.deleteMany({where: {symbol, date: {gte: fromDate}}}),
        prisma.dailyPrice.createMany({
            data: bars.map((bar) => ({
                symbol,
                date: toUtcDate(bar.date),
                open: bar.open ?? bar.close!,
                high: bar.high ?? bar.close!,
                low: bar.low ?? bar.close!,
                close: bar.close!,
                volume: BigInt(Math.round(bar.volume ?? 0)),
                currency,
            })),
            skipDuplicates: true,
        }),
    ]);
}

export async function syncBenchmarkPrices(symbol: string, from: Date) {
    const bars = await fetchDailyBars(symbol, from);
    const fromDate = toUtcDate(from);

    await prisma.$transaction([
        prisma.benchmarkPrice.deleteMany({where: {symbol, date: {gte: fromDate}}}),
        prisma.benchmarkPrice.createMany({
            data: bars.map((bar) => ({
                symbol,
                date: toUtcDate(bar.date),
                close: bar.close!,
            })),
            skipDuplicates: true,
        }),
    ]);
}

export async function syncUsdMyrRate(from: Date) {
    const bars = await fetchDailyBars(USD_MYR_SYMBOL, from);
    const fromDate = toUtcDate(from);

    await prisma.$transaction([
        prisma.exchangeRate.deleteMany({
            where: {from: Currency.USD, to: Currency.MYR, date: {gte: fromDate}},
        }),
        prisma.exchangeRate.createMany({
            data: bars.map((bar) => ({
                from: Currency.USD,
                to: Currency.MYR,
                date: toUtcDate(bar.date),
                rate: bar.close!,
            })),
            skipDuplicates: true,
        }),
    ]);
}

export async function syncMarketData(daysBack = 400) {
    const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const symbols = await getTrackedSymbols();
    for (const symbol of symbols) {
      await syncDailyPrices(symbol, from);
    }
    for (const benchmark of BENCHMARK_SYMBOLS) {
      await syncBenchmarkPrices(benchmark, from);
    }
    await syncUsdMyrRate(from);
    return { symbols: symbols.length, benchmarks: BENCHMARK_SYMBOLS.length };
}

const SEARCHABLE_TYPES = new Set(["EQUITY", "ETF"]);

function isAppMarketSymbol(symbol: string): boolean {
    const s = symbol.toUpperCase();
    return s.endsWith(".KL") || !s.includes(".");
}

export type SymbolSearchHit = {
    symbol: string;
    name: string;
    exchange: string;
};

export async function searchSymbols(query: string): Promise<SymbolSearchHit[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    const result = await yahooFinance.search(q, {quotesCount: 25, newsCount: 0});
    const hits: SymbolSearchHit[] = [];

    for (const quote of result.quotes) {
        if (!("isYahooFinance" in quote) || !quote.isYahooFinance) continue;
        if (!("quoteType" in quote) || !SEARCHABLE_TYPES.has(quote.quoteType)) continue;
        if (!quote.symbol || !isAppMarketSymbol(quote.symbol)) continue;

        hits.push({
            symbol: quote.symbol.toUpperCase(),
            name: quote.shortname ?? quote.longname ?? quote.symbol,
            exchange: quote.exchDisp ?? quote.exchange,
        });
    }

    return hits;
}

export type MarketClose = {
    symbol: string;
    date: string;
    close: number;
    currency: Currency;
};

export async function getCloseOnOrBefore(symbol: string, onDate: Date): Promise<MarketClose | null> {
    const ticker = symbol.trim().toUpperCase();
    const target = toUtcDate(onDate);

    async function lookup() {
        return prisma.dailyPrice.findFirst({
            where: {symbol: ticker, date: {lte: target}},
            orderBy: {date: "desc"},
        });
    }

    let row = await lookup();
    if (!row) {
        const from = new Date(target.getTime() - 45 * 24 * 60 * 60 * 1000);
        try {
            await syncDailyPrices(ticker, from);
        } catch (err) {
            console.error("[close] Yahoo fetch failed", ticker, err);
            return null;
        }
        row = await lookup();
    }
    if (!row) return null;

    return {
        symbol: ticker,
        date: row.date.toISOString().slice(0, 10),
        close: Number(row.close),
        currency: row.currency,
    };
}
  