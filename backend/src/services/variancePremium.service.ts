import macroEvents from "../data/macroEvents.json";
import {AppError} from "../utils/AppError";
import {yahooFinance} from "./market.service";
import {resolveEventDates, type EventType} from "./events.service";
import {
    atmStraddle,
    getIvHistory,
    IV_RANK_MIN_SESSIONS,
    type IvHistory,
    type OptionLeg,
} from "./impliedSnapshot.service";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PremiumMove = {
    date: string;
    /** Close on the event session versus the previous close. */
    move: number;
};

export type VariancePremium = {
    symbol: string;
    eventType: EventType;
    years: number;
    /** First calendar date on or after today, if one is known. */
    nextEvent: string | null;
    /** Expiry whose straddle still covers that event. */
    expiry: string | null;
    /** Last expiry before the event, when one exists. */
    expiryBefore: string | null;
    spot: number | null;
    /** ATM IV on the covering expiry, annualized. */
    atmIv: number | null;
    /**
     * Expected absolute move the market assigns to the event, as a fraction of spot.
     * term-structure: sqrt(2/π) · sqrt(σ²_after·T_after − σ²_before·T_before).
     * straddle: (call mid + put mid) / spot on the covering expiry.
     */
    impliedMove: number | null;
    method: "term-structure" | "straddle" | null;
    moves: PremiumMove[];
    stats: {
        n: number;
        medianAbs: number | null;
        meanAbs: number | null;
        /** impliedMove − mean absolute realized move. Both are expected-absolute-move quantities. */
        gap: number | null;
        /** Share of past absolute moves that were smaller than today's price. */
        percentile: number | null;
    };
    /** Front-month ATM IV rank from rows this app recorded. Null until enough sessions exist. */
    ivHistory: IvHistory | null;
    notes: string[];
};

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Fraction of the sample at or below `value`. */
export function percentileRank(sample: number[], value: number): number | null {
    if (sample.length === 0 || !Number.isFinite(value)) return null;
    return sample.filter((item) => item <= value).length / sample.length;
}

/** First listed expiry on or after the event. Null when the chain ends first. */
export function expiryCovering(expiries: string[], eventDate: string): string | null {
    const sorted = [...expiries].sort();
    return sorted.find((expiry) => expiry >= eventDate) ?? null;
}

/**
 * Move from the close before the event to the close `sessions` trading days
 * later, anchored on the first session on or after the event date. Macro
 * releases land inside the session, so one session is the reaction. Earnings
 * dates carry no time of day and most US names report after the close, so two
 * sessions are needed to be sure the reaction is inside the window.
 */
export function eventSessionMove(
    keys: string[],
    closes: number[],
    eventDate: string,
    sessions: 1 | 2 = 1
): PremiumMove | null {
    const anchor = keys.findIndex((key) => key >= eventDate);
    if (anchor <= 0) return null;
    const end = anchor + sessions - 1;
    if (end >= keys.length) return null;
    const prev = closes[anchor - 1];
    const next = closes[end];
    if (!(prev > 0) || !(next > 0)) return null;
    return {date: keys[anchor], move: (next - prev) / prev};
}

export function sessionsFor(eventType: EventType): 1 | 2 {
    return eventType === "EARNINGS" ? 2 : 1;
}

function nextMacro(type: "FOMC" | "CPI", today: string): string | null {
    const dates = type === "FOMC" ? macroEvents.fomc : macroEvents.cpi;
    return [...dates].sort().find((date) => date >= today) ?? null;
}

async function nextEarnings(symbol: string, today: string): Promise<string | null> {
    try {
        const summary = (await yahooFinance.quoteSummary(symbol, {
            modules: ["calendarEvents"],
        })) as {
            calendarEvents?: {
                earnings?: {earningsDate?: (Date | number | string)[]; earningsCallDate?: (Date | number | string)[]};
            };
        };
        // earningsCallDate is the last call that happened; earningsDate holds the
        // next one (sometimes a range). Take the earliest date still ahead.
        const earnings = summary.calendarEvents?.earnings;
        const candidates = [...(earnings?.earningsDate ?? []), ...(earnings?.earningsCallDate ?? [])]
            .map((raw) => (raw instanceof Date ? raw : new Date(raw)))
            .filter((date) => !Number.isNaN(date.getTime()))
            .map(toDateKey)
            .filter((key) => key >= today)
            .sort();
        return candidates[0] ?? null;
    } catch {
        return null;
    }
}

async function loadCloses(symbol: string, from: Date): Promise<{keys: string[]; closes: number[]}> {
    const result = await yahooFinance.chart(symbol, {period1: from, interval: "1d"});
    const keys: string[] = [];
    const closes: number[] = [];
    const seen = new Set<string>();
    for (const quote of result.quotes) {
        if (quote.close == null || !(quote.close > 0)) continue;
        const key = toDateKey(quote.date);
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
        closes.push(quote.close);
    }
    return {keys, closes};
}

/** E|X| for X ~ N(0, σ²). A straddle is priced on this, so realized moves are compared on the same scale. */
export const EXPECTED_ABS_FACTOR = Math.sqrt(2 / Math.PI);

/** Last expiry strictly before the event; null when the event sits inside the front expiry. */
export function expiryBefore(expiries: string[], eventDate: string): string | null {
    const sorted = [...expiries].sort();
    return [...sorted].reverse().find((expiry) => expiry < eventDate) ?? null;
}

/**
 * Variance the market assigns to the event alone. Total variance to the expiry
 * after the event minus total variance to the expiry before it; what is left
 * is the sessions in between, which is the event when the expiries bracket it.
 * Null when the term structure is inverted enough to make that negative.
 */
export function eventVariance(ivBefore: number, yearsBefore: number, ivAfter: number, yearsAfter: number): number | null {
    if (!(ivBefore > 0 && ivAfter > 0 && yearsAfter > yearsBefore && yearsBefore >= 0)) return null;
    const diff = ivAfter * ivAfter * yearsAfter - ivBefore * ivBefore * yearsBefore;
    return diff > 0 ? diff : null;
}

/** Yahoo's IV when present, otherwise the IV the straddle price alone implies. */
export function impliedFromStraddle(straddle: {impliedMove: number; atmIv: number | null}, years: number): number | null {
    if (straddle.atmIv != null && straddle.atmIv > 0) return straddle.atmIv;
    if (!(years > 0)) return null;
    return straddle.impliedMove / (EXPECTED_ABS_FACTOR * Math.sqrt(years));
}

type LiveQuote = {
    impliedMove: number | null;
    atmIv: number | null;
    expiry: string | null;
    expiryBefore: string | null;
    spot: number | null;
    method: "term-structure" | "straddle" | null;
    chainNote: string | null;
};

async function liveStraddle(symbol: string, eventDate: string | null): Promise<LiveQuote> {
    const empty: LiveQuote = {impliedMove: null, atmIv: null, expiry: null, expiryBefore: null, spot: null, method: null, chainNote: null};
    if (symbol.includes(".")) {
        return {...empty, chainNote: "Listed options are US names only, so there is no straddle to price."};
    }
    if (!eventDate) {
        return {...empty, chainNote: "No upcoming date on the calendar, so there is no expiry to price."};
    }

    let head;
    try {
        head = await yahooFinance.options(symbol);
    } catch (err) {
        console.error("[premium] options lookup failed", symbol, err);
        return {...empty, chainNote: "The options chain is unavailable right now."};
    }

    const now = new Date();
    const spot = Number((head.quote as {regularMarketPrice?: number}).regularMarketPrice);
    const listed = (head.expirationDates ?? [])
        .map((date) => {
            const asDate = date instanceof Date ? date : new Date(date);
            return {key: toDateKey(asDate), date: asDate};
        })
        .sort((a, b) => a.key.localeCompare(b.key));
    const keys = listed.map((item) => item.key);
    const after = listed.find((item) => item.key === expiryCovering(keys, eventDate));
    const before = listed.find((item) => item.key === expiryBefore(keys, eventDate));
    if (!Number.isFinite(spot) || spot <= 0 || !after) {
        return {
            ...empty,
            spot: Number.isFinite(spot) ? spot : null,
            chainNote: after ? "Underlying price is missing." : "The next event sits beyond the listed expiries.",
        };
    }

    async function quoteExpiry(item: {key: string; date: Date}) {
        try {
            const chain = await yahooFinance.options(symbol, {date: item.date});
            const slice = chain.options?.[0];
            const straddle = atmStraddle((slice?.calls ?? []) as OptionLeg[], (slice?.puts ?? []) as OptionLeg[], spot);
            if (!straddle) return null;
            const years = (item.date.getTime() - now.getTime()) / (365.25 * DAY_MS);
            return {straddle, years, iv: impliedFromStraddle(straddle, years)};
        } catch (err) {
            console.error("[premium] expiry fetch failed", symbol, item.key, err);
            return null;
        }
    }

    const [quotedAfter, quotedBefore] = await Promise.all([quoteExpiry(after), before ? quoteExpiry(before) : null]);
    if (!quotedAfter) {
        return {...empty, spot, expiry: after.key, chainNote: "The at-the-money straddle on the covering expiry has no usable quote."};
    }

    const base = {
        atmIv: quotedAfter.straddle.atmIv,
        expiry: after.key,
        spot,
    };

    if (quotedBefore && quotedBefore.iv != null && quotedAfter.iv != null) {
        const variance = eventVariance(quotedBefore.iv, quotedBefore.years, quotedAfter.iv, quotedAfter.years);
        if (variance != null) {
            return {
                ...base,
                impliedMove: EXPECTED_ABS_FACTOR * Math.sqrt(variance),
                expiryBefore: before!.key,
                method: "term-structure",
                chainNote: null,
            };
        }
        return {
            ...base,
            impliedMove: quotedAfter.straddle.impliedMove,
            expiryBefore: before!.key,
            method: "straddle",
            chainNote: `The ${before!.key} and ${after.key} expiries carry no extra variance for the event, so the straddle to ${after.key} is shown instead. It covers every session to expiry, not only the event.`,
        };
    }

    const sessions = Math.max(1, Math.round((after.date.getTime() - now.getTime()) / DAY_MS));
    return {
        ...base,
        impliedMove: quotedAfter.straddle.impliedMove,
        expiryBefore: before?.key ?? null,
        method: "straddle",
        chainNote:
            sessions > 3
                ? `No expiry sits before the event, so the straddle to ${after.key} is shown. It covers ${sessions} calendar days, not only the event session.`
                : null,
    };
}

export async function getVariancePremium(
    rawSymbol: string,
    eventType: EventType,
    years: number
): Promise<VariancePremium> {
    const symbol = rawSymbol.trim().toUpperCase();
    const today = toDateKey(new Date());
    const from = new Date(Date.now() - years * 365.25 * DAY_MS);
    const fromKey = toDateKey(from);
    const barsFrom = new Date(from.getTime() - 10 * DAY_MS);
    const notes = [
        "Yahoo does not publish historical option prices, so this is today's straddle against past realized moves, not a backtest of past implied vol.",
        eventType === "EARNINGS"
            ? "The realized move runs from the close before the earnings date to the close of the following session, so after-close reports are inside the window."
            : "The realized move is the event session versus the previous close.",
        "The implied move is the extra variance between the expiry before the event and the one after it, turned into an expected absolute move; when no expiry sits before the event, the covering straddle is shown instead.",
    ];

    let past: {date: string}[] = [];
    try {
        past = await resolveEventDates(eventType, [symbol], fromKey, today);
    } catch (err) {
        if (err instanceof AppError) notes.push(err.message);
        else throw err;
    }

    let keys: string[] = [];
    let closes: number[] = [];
    try {
        const bars = await loadCloses(symbol, barsFrom);
        keys = bars.keys;
        closes = bars.closes;
    } catch (err) {
        console.error("[premium] chart fetch failed", symbol, err);
        notes.push(`Could not load price history for ${symbol}.`);
    }

    const sessions = sessionsFor(eventType);
    const moves = past
        .map((event) => eventSessionMove(keys, closes, event.date, sessions))
        .filter((move): move is PremiumMove => move != null && move.date < today);

    const abs = moves.map((move) => Math.abs(move.move));
    const medianAbs = median(abs);
    const meanAbs = abs.length === 0 ? null : abs.reduce((sum, value) => sum + value, 0) / abs.length;

    const nextEvent =
        eventType === "EARNINGS" ? await nextEarnings(symbol, today) : nextMacro(eventType, today);
    const quoted = await liveStraddle(symbol, nextEvent);
    if (quoted.chainNote) notes.push(quoted.chainNote);

    const stored = symbol.includes(".")
        ? {history: null, recorded: 0, since: null, missed: [] as string[]}
        : await getIvHistory(symbol);
    if (stored.history) {
        notes.push(
            `IV rank uses ${stored.history.n} front-month sessions this app recorded since ${stored.history.since}. It is not Yahoo data.`
        );
    } else if (stored.recorded > 0) {
        notes.push(
            `IV rank needs ${IV_RANK_MIN_SESSIONS} recorded sessions; ${stored.recorded} so far since ${stored.since}. The daily sync adds one per US session.`
        );
    } else if (!symbol.includes(".")) {
        notes.push(`No IV history recorded for ${symbol} yet. Add it to a portfolio and the daily sync starts building it.`);
    }
    if (stored.missed.length > 0) {
        const shown = stored.missed.slice(0, 5).join(", ");
        const more = stored.missed.length > 5 ? ` and ${stored.missed.length - 5} more` : "";
        notes.push(
            `${stored.missed.length} US sessions since ${stored.since} have no recording (${shown}${more}): no sync ran after that close, or the chain had no usable at-the-money quote. Yahoo serves only the current chain, so they stay empty.`
        );
    }

    const gap = quoted.impliedMove != null && meanAbs != null ? quoted.impliedMove - meanAbs : null;

    return {
        symbol,
        eventType,
        years,
        nextEvent,
        expiry: quoted.expiry,
        expiryBefore: quoted.expiryBefore,
        spot: quoted.spot,
        atmIv: quoted.atmIv,
        impliedMove: quoted.impliedMove,
        method: quoted.method,
        moves,
        stats: {
            n: moves.length,
            medianAbs,
            meanAbs,
            gap,
            percentile: quoted.impliedMove != null ? percentileRank(abs, quoted.impliedMove) : null,
        },
        ivHistory: stored.history,
        notes,
    };
}
