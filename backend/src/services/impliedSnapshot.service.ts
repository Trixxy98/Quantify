import {prisma} from "../lib/prisma";
import {yahooFinance} from "./market.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Front expiry has to be at least this far out so weeklies about to expire do not pin the series. */
const MIN_TENOR_DAYS = 20;
/** One trading year of sessions. */
export const IV_RANK_LOOKBACK = 252;
/** Below this the rank is just noise about which day you started recording. */
export const IV_RANK_MIN_SESSIONS = 20;
/** Recorded even when not held: the Events page defaults to it and it is the market's own straddle. */
const ALWAYS_RECORD = ["SPY"];

export type OptionLeg = {
    bid?: number;
    ask?: number;
    lastPrice?: number;
    impliedVolatility?: number;
    strike?: number;
};

export type AtmStraddle = {
    strike: number;
    callMid: number;
    putMid: number;
    /** (callMid + putMid) / spot, unsigned. */
    impliedMove: number;
    /** Mean of the ATM call and put IV as Yahoo quotes them, or null if both missing. */
    atmIv: number | null;
};

export type IvHistory = {
    n: number;
    since: string;
    current: number;
    low: number;
    high: number;
    /** (current − low) / (high − low), 0..1. */
    rank: number;
    /** Share of recorded sessions at or below current, 0..1. */
    percentile: number;
    expiry: string;
};

export function midPrice(bid?: number, ask?: number, last?: number): number | null {
    if (bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
    if (last != null && last > 0) return last;
    return null;
}

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function toUtcDate(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function asDate(value: Date | number | string): Date {
    return value instanceof Date ? value : new Date(value);
}

/** Nearest strike to spot with a usable quote on both legs. */
export function atmStraddle(calls: OptionLeg[], puts: OptionLeg[], spot: number): AtmStraddle | null {
    if (!(spot > 0)) return null;
    const putsByStrike = new Map(puts.filter((put) => put.strike != null).map((put) => [put.strike!, put]));
    const candidates = calls
        .filter((call) => call.strike != null && putsByStrike.has(call.strike))
        .sort((a, b) => Math.abs(a.strike! - spot) - Math.abs(b.strike! - spot));

    for (const call of candidates) {
        const put = putsByStrike.get(call.strike!)!;
        const callMid = midPrice(call.bid, call.ask, call.lastPrice);
        const putMid = midPrice(put.bid, put.ask, put.lastPrice);
        if (callMid == null || putMid == null) continue;
        const ivs = [call.impliedVolatility, put.impliedVolatility].filter(
            (iv): iv is number => iv != null && Number.isFinite(iv) && iv > 0
        );
        return {
            strike: call.strike!,
            callMid,
            putMid,
            impliedMove: (callMid + putMid) / spot,
            atmIv: ivs.length === 0 ? null : ivs.reduce((sum, iv) => sum + iv, 0) / ivs.length,
        };
    }
    return null;
}

/** First expiry at least MIN_TENOR_DAYS out, so consecutive days measure a similar tenor. */
export function frontMonthExpiry(expiries: Date[], now: Date): Date | null {
    const floor = now.getTime() + MIN_TENOR_DAYS * DAY_MS;
    return (
        [...expiries]
            .sort((a, b) => a.getTime() - b.getTime())
            .find((expiry) => expiry.getTime() >= floor) ?? null
    );
}

export function ivRank(history: {iv: number}[], current: number): {rank: number; percentile: number; low: number; high: number} {
    const ivs = history.map((row) => row.iv);
    const low = Math.min(...ivs);
    const high = Math.max(...ivs);
    const rank = high > low ? (current - low) / (high - low) : 0.5;
    const percentile = ivs.filter((iv) => iv <= current).length / ivs.length;
    return {rank, percentile, low, high};
}

async function captureOne(symbol: string, now: Date): Promise<boolean> {
    const head = await yahooFinance.options(symbol);
    const quote = head.quote as {regularMarketPrice?: number; regularMarketTime?: Date | number | string};
    const spot = Number(quote.regularMarketPrice);
    if (!Number.isFinite(spot) || spot <= 0) return false;

    const expiry = frontMonthExpiry((head.expirationDates ?? []).map(asDate), now);
    if (!expiry) return false;

    const chain = await yahooFinance.options(symbol, {date: expiry});
    const slice = chain.options?.[0];
    const straddle = atmStraddle((slice?.calls ?? []) as OptionLeg[], (slice?.puts ?? []) as OptionLeg[], spot);
    if (!straddle || straddle.atmIv == null) return false;

    // The marks belong to the last US session, not to the MYT morning the cron runs on.
    const session = toUtcDate(quote.regularMarketTime ? asDate(quote.regularMarketTime) : now);
    const row = {
        expiry: toUtcDate(expiry),
        spot,
        strike: straddle.strike,
        atmIv: straddle.atmIv,
        straddleMove: straddle.impliedMove,
    };
    await prisma.impliedSnapshot.upsert({
        where: {symbol_date: {symbol, date: session}},
        create: {symbol, date: session, ...row},
        update: row,
    });
    return true;
}

/**
 * Records one ATM implied-vol row per US symbol. Failures are per symbol and
 * logged, because a thin chain on one name must not stop the daily sync.
 */
export async function captureImpliedSnapshots(symbols: string[]): Promise<{attempted: number; recorded: number}> {
    const now = new Date();
    const usSymbols = [...new Set([...ALWAYS_RECORD, ...symbols])].filter((symbol) => !symbol.includes("."));
    let recorded = 0;
    for (const symbol of usSymbols) {
        try {
            if (await captureOne(symbol, now)) recorded += 1;
        } catch (err) {
            console.error("[iv-snapshot] capture failed", symbol, err);
        }
    }
    return {attempted: usSymbols.length, recorded};
}

/** Sessions in `calendar` on or after `since` that have no recorded row. */
export function missedSessions(calendar: string[], recorded: string[], since: string): string[] {
    const have = new Set(recorded);
    return calendar.filter((date) => date >= since && !have.has(date));
}

/** US trading days from the ^GSPC bars, which follow the exchange calendar including holidays. */
async function usSessionsSince(since: Date): Promise<string[]> {
    const rows = await prisma.benchmarkPrice.findMany({
        where: {symbol: "^GSPC", date: {gte: since}},
        orderBy: {date: "asc"},
        select: {date: true},
    });
    return rows.map((row) => toDateKey(row.date));
}

/** IV rank from the rows this app has recorded. Null until enough sessions exist. */
export async function getIvHistory(
    symbol: string
): Promise<{history: IvHistory | null; recorded: number; since: string | null; missed: string[]}> {
    const rows = await prisma.impliedSnapshot.findMany({
        where: {symbol},
        orderBy: {date: "desc"},
        take: IV_RANK_LOOKBACK,
        select: {date: true, atmIv: true, expiry: true},
    });
    if (rows.length === 0) return {history: null, recorded: 0, since: null, missed: []};

    const since = toDateKey(rows[rows.length - 1].date);
    const missed = missedSessions(
        await usSessionsSince(rows[rows.length - 1].date),
        rows.map((row) => toDateKey(row.date)),
        since
    );
    if (rows.length < IV_RANK_MIN_SESSIONS) return {history: null, recorded: rows.length, since, missed};

    const series = rows.map((row) => ({iv: Number(row.atmIv)}));
    const current = series[0].iv;
    const stats = ivRank(series, current);
    return {
        recorded: rows.length,
        since,
        missed,
        history: {
            n: rows.length,
            since,
            current,
            expiry: toDateKey(rows[0].expiry),
            ...stats,
        },
    };
}
