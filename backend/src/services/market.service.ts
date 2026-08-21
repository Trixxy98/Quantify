import YahooFinance from "yahoo-finance2";
import {Currency} from "@prisma/client";
import {prisma} from "../lib/prisma";

// v3: default export ialah class — perlu instantiate dulu
const yahooFinance = new YahooFinance();

export const BENCHMARK_SYMBOLS = ["^KLSE", "^GSPC"];
const USD_MYR_SYMBOL = "MYR=X";

export function currencyFromSymbol(symbol: string): Currency {
    return symbol.toUpperCase().endsWith(".KL") ? Currency.MYR : Currency.USD;
}

// Normalisasi ke UTC midnight — guna getter UTC supaya tarikh bar US
// (tutup 20:00 UTC) tak "terlompat" ke hari esok bila server di timezone MYT
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

    await prisma.dailyPrice.createMany({
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
    });
}

export async function syncBenchmarkPrices(symbol: string, from: Date) {
    const bars = await fetchDailyBars(symbol, from);

    await prisma.benchmarkPrice.createMany({
        data: bars.map((bar) => ({
            symbol,
            date: toUtcDate(bar.date),
            close: bar.close!,
        })),
        skipDuplicates: true,
    });
}

export async function syncUsdMyrRate(from: Date) {
    const bars = await fetchDailyBars(USD_MYR_SYMBOL, from);

    await prisma.exchangeRate.createMany({
        data: bars.map((bar) => ({
            from: Currency.USD,
            to: Currency.MYR,
            date: toUtcDate(bar.date),
            rate: bar.close!,
        })),
        skipDuplicates: true,
    });
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
  