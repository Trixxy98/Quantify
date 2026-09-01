import YahooFinance from "yahoo-finance2";
import {Currency} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {isRebased} from "./corporateActions";

// v3: default export is a class — instantiate first
export const yahooFinance = new YahooFinance();

// ^SP500TR is the total-return version of the S&P 500: the dashboard compares
// it against a portfolio that now counts dividends, so a price index there
// would hand the portfolio free alpha. ^GSPC stays for price-vs-price work
// (per-symbol beta, event studies).
export const BENCHMARK_SYMBOLS = ["^KLSE", "^GSPC", "^SP500TR"];
const USD_MYR_SYMBOL = "MYR=X";

export function currencyFromSymbol(symbol: string): Currency {
    return symbol.toUpperCase().endsWith(".KL") ? Currency.MYR : Currency.USD;
}

// Normalize to UTC midnight — use UTC getters so US session close (20:00 UTC)
// does not roll into the next calendar day on a MYT server
function toUtcDate(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Corporate actions have to be complete regardless of how short the price
// refresh window is, so events are always pulled from the start of history.
const HISTORY_START = new Date("2000-01-01T00:00:00.000Z");

type ChartEvents = {
    dividends?: {amount?: number; date?: Date}[];
    splits?: {date?: Date; numerator?: number; denominator?: number}[];
};

async function fetchChart(symbol: string, from: Date) {
    const result = await yahooFinance.chart(symbol, {
        period1: from,
        interval: "1d",
        events: "div|split",
    });
    return {
        quotes: result.quotes.filter((q) => q.close != null),
        events: (result.events ?? {}) as ChartEvents,
    };
}

async function fetchDailyBars(symbol: string, from: Date) {
    const {quotes} = await fetchChart(symbol, from);
    return quotes;
}

/** Compares the oldest stored bar against what Yahoo reports for that same day. */
async function hasRebased(symbol: string, bars: {date: Date; close?: number | null}[]) {
    const stored = await prisma.dailyPrice.findFirst({
        where: {symbol},
        orderBy: {date: "asc"},
    });
    if (!stored) return false;

    const storedTime = toUtcDate(stored.date).getTime();
    const match = bars.find((bar) => toUtcDate(bar.date).getTime() === storedTime);
    if (!match?.close) return false;

    return isRebased(Number(stored.close), match.close);
}

async function saveCorporateActions(symbol: string, events: ChartEvents) {
    const currency = currencyFromSymbol(symbol);

    const splits = (events.splits ?? [])
        .filter((s) => s.date && s.numerator && s.denominator)
        .map((s) => ({
            symbol,
            date: toUtcDate(s.date!),
            numerator: Math.round(s.numerator!),
            denominator: Math.round(s.denominator!),
        }));

    const dividends = (events.dividends ?? [])
        .filter((d) => d.date && d.amount != null && d.amount > 0)
        .map((d) => ({symbol, exDate: toUtcDate(d.date!), amount: d.amount!, currency}));

    await prisma.$transaction([
        prisma.stockSplit.deleteMany({where: {symbol}}),
        prisma.stockSplit.createMany({data: splits, skipDuplicates: true}),
        prisma.dividend.deleteMany({where: {symbol}}),
        prisma.dividend.createMany({data: dividends, skipDuplicates: true}),
    ]);

    return {splits: splits.length, dividends: dividends.length};
}

export async function getTrackedSymbols(): Promise<string[]> {
    const holdings = await prisma.holding.findMany({
        select: {symbol: true},
        distinct: ["symbol"],
    });
    return holdings.map((h) => h.symbol);
}

export async function syncDailyPrices(symbol: string, from: Date) {
    // One call covers everything: events need full history, prices only need
    // the requested window unless the series turns out to have been rebased.
    const {quotes: bars, events} = await fetchChart(symbol, HISTORY_START);
    const currency = currencyFromSymbol(symbol);

    await saveCorporateActions(symbol, events);

    const rebased = await hasRebased(symbol, bars);
    const fromDate = rebased ? HISTORY_START : toUtcDate(from);
    if (rebased) {
        console.warn(`[sync] ${symbol} was restated by Yahoo — rewriting full price history`);
    }

    const rows = bars
        .filter((bar) => toUtcDate(bar.date).getTime() >= fromDate.getTime())
        .map((bar) => ({
            symbol,
            date: toUtcDate(bar.date),
            open: bar.open ?? bar.close!,
            high: bar.high ?? bar.close!,
            low: bar.low ?? bar.close!,
            close: bar.close!,
            volume: BigInt(Math.round(bar.volume ?? 0)),
            currency,
        }));

    await prisma.$transaction([
        prisma.dailyPrice.deleteMany({where: {symbol, date: {gte: fromDate}}}),
        prisma.dailyPrice.createMany({data: rows, skipDuplicates: true}),
    ]);
}

export async function syncBenchmarkPrices(symbol: string, from: Date) {
    // A benchmark added later (^SP500TR) starts empty, and a short window would
    // leave it too short to ever be picked over the one already stored.
    const existing = await prisma.benchmarkPrice.count({where: {symbol}});
    const start = existing === 0 ? HISTORY_START : from;

    const bars = await fetchDailyBars(symbol, start);
    const fromDate = toUtcDate(start);

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

// Short cache so several open tabs polling the tape share one Yahoo call.
const QUOTE_TTL_MS = 15_000;
const quoteCache = new Map<string, {value: TickerQuote; expiresAt: number}>();

type RawQuote = {
    symbol?: string;
    shortName?: string;
    longName?: string;
    regularMarketPrice?: number;
    regularMarketChange?: number;
    regularMarketChangePercent?: number;
    currency?: string;
    marketState?: string;
    regularMarketTime?: Date | number | string;
};

function toTickerQuote(raw: RawQuote): TickerQuote | null {
    const symbol = raw.symbol?.toUpperCase();
    const price = Number(raw.regularMarketPrice);
    if (!symbol || !Number.isFinite(price)) return null;

    const time = raw.regularMarketTime;
    const asOf = time == null ? null : new Date(time instanceof Date ? time : time).toISOString();

    return {
        symbol,
        name: raw.shortName ?? raw.longName ?? symbol,
        price,
        change: Number.isFinite(Number(raw.regularMarketChange)) ? Number(raw.regularMarketChange) : 0,
        changePercent: Number.isFinite(Number(raw.regularMarketChangePercent))
            ? Number(raw.regularMarketChangePercent) / 100
            : 0,
        currency: raw.currency ?? "",
        marketState: raw.marketState ?? "UNKNOWN",
        asOf: asOf && !Number.isNaN(Date.parse(asOf)) ? asOf : null,
    };
}

export async function getQuotes(symbols: string[]): Promise<TickerQuote[]> {
    const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const now = Date.now();
    const resolved = new Map<string, TickerQuote>();
    const missing: string[] = [];

    for (const symbol of wanted) {
        const cached = quoteCache.get(symbol);
        if (cached && cached.expiresAt > now) resolved.set(symbol, cached.value);
        else missing.push(symbol);
    }

    if (missing.length > 0) {
        const result = await yahooFinance.quote(missing);
        const rows = (Array.isArray(result) ? result : [result]) as RawQuote[];
        for (const row of rows) {
            const quote = toTickerQuote(row);
            if (!quote) continue;
            resolved.set(quote.symbol, quote);
            quoteCache.set(quote.symbol, {value: quote, expiresAt: now + QUOTE_TTL_MS});
        }
    }

    return wanted
        .map((symbol) => resolved.get(symbol))
        .filter((quote): quote is TickerQuote => quote != null);
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
  