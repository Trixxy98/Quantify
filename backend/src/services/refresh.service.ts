import {Currency} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {isFullSyncRunning} from "../jobs/sync.job";
import {
    BENCHMARK_SYMBOLS,
    syncBenchmarkPrices,
    syncDailyPrices,
    syncUsdMyrRate,
} from "./market.service";
import {rebuildSnapshots} from "./snapshot.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 3 * DAY_MS;

function padded(date: Date) {
    return new Date(date.getTime() - 7 * DAY_MS);
}

function needsHistory(
    first: Date | undefined,
    last: Date | undefined,
    from: Date
) {
    if (!first || !last) return true;
    if (first.getTime() > from.getTime() + DAY_MS) return true;
    return Date.now() - last.getTime() > STALE_MS;
}

async function ensureDailyPrices(symbol: string, from: Date) {
    const first = await prisma.dailyPrice.findFirst({
        where: {symbol},
        orderBy: {date: "asc"},
        select: {date: true},
    });
    const last = await prisma.dailyPrice.findFirst({
        where: {symbol},
        orderBy: {date: "desc"},
        select: {date: true},
    });
    if (needsHistory(first?.date, last?.date, from)) {
        await syncDailyPrices(symbol, from);
    }
}

async function ensureUsdMyr(from: Date) {
    const first = await prisma.exchangeRate.findFirst({
        where: {from: Currency.USD, to: Currency.MYR},
        orderBy: {date: "asc"},
        select: {date: true},
    });
    const last = await prisma.exchangeRate.findFirst({
        where: {from: Currency.USD, to: Currency.MYR},
        orderBy: {date: "desc"},
        select: {date: true},
    });
    if (needsHistory(first?.date, last?.date, from)) {
        await syncUsdMyrRate(from);
    }
}

async function ensureBenchmarks(from: Date) {
    for (const symbol of BENCHMARK_SYMBOLS) {
        const first = await prisma.benchmarkPrice.findFirst({
            where: {symbol},
            orderBy: {date: "asc"},
            select: {date: true},
        });
        const last = await prisma.benchmarkPrice.findFirst({
            where: {symbol},
            orderBy: {date: "desc"},
            select: {date: true},
        });
        if (needsHistory(first?.date, last?.date, from)) {
            await syncBenchmarkPrices(symbol, from);
        }
    }
}

export async function refreshPortfolioAfterTrade(portfolioId: string, symbols: string[]) {
    if (isFullSyncRunning()) return;

    const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];

    for (const symbol of unique) {
        const earliest = await prisma.transaction.findFirst({
            where: {portfolioId, symbol},
            orderBy: {date: "asc"},
            select: {date: true},
        });
        if (!earliest) continue;
        await ensureDailyPrices(symbol, padded(earliest.date));
    }

    const firstTx = await prisma.transaction.findFirst({
        where: {portfolioId},
        orderBy: {date: "asc"},
        select: {date: true},
    });
    if (firstTx) {
        const from = padded(firstTx.date);
        await ensureUsdMyr(from);
        await ensureBenchmarks(from);
    }

    await rebuildSnapshots(portfolioId);
}

export async function refreshPortfolioAfterTradeQuietly(portfolioId: string, symbols: string[]) {
    try {
        await refreshPortfolioAfterTrade(portfolioId, symbols);
    } catch (err) {
        console.error("[trade] market refresh failed", portfolioId, symbols, err);
    }
}
