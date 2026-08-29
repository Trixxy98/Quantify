import {env} from "../config/env";
import {AppError} from "../utils/AppError";
import {impliedVol, type OptionRight} from "./blackScholes";
import {yahooFinance} from "./market.service";

const MAX_EXPIRIES = 8;
const MIN_MONEYNESS = 0.7;
const MAX_MONEYNESS = 1.3;
const MIN_TTM_YEARS = 2 / 365;
const MIN_MID = 0.05;

export type IvSurfacePoint = {
    expiry: string;
    ttm: number;
    strike: number;
    moneyness: number;
    iv: number;
    mid: number;
    right: OptionRight;
    method: "newton" | "bisection";
    yahooIv: number | null;
};

export type IvSurface = {
    symbol: string;
    spot: number;
    rate: number;
    dividendYield: number;
    asOf: string;
    points: IvSurfacePoint[];
    newtonCount: number;
    bisectionCount: number;
};

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function yearsTo(expiry: Date, now: Date): number {
    return (expiry.getTime() - now.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function midPrice(bid?: number, ask?: number, last?: number): number | null {
    if (bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid) {
        return (bid + ask) / 2;
    }
    if (last != null && last > 0) return last;
    return null;
}

function dividendYield(quote: {trailingAnnualDividendYield?: number; dividendYield?: number}): number {
    const raw = Number(quote.trailingAnnualDividendYield ?? quote.dividendYield ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw > 0.2 ? raw / 100 : raw;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const idx = next++;
            out[idx] = await fn(items[idx]);
        }
    }
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, () => worker()));
    return out;
}

function pickExpiries(dates: Date[], now: Date): Date[] {
    const future = dates
        .filter((d) => d.getTime() > now.getTime() + 2 * 24 * 60 * 60 * 1000)
        .sort((a, b) => a.getTime() - b.getTime());
    if (future.length <= MAX_EXPIRIES) return future;
    const picked = future.slice(0, 3);
    const rest = future.slice(3);
    const slots = MAX_EXPIRIES - 3;
    for (let i = 0; i < slots; i++) {
        const idx = Math.round((i + 1) * (rest.length - 1) / slots);
        picked.push(rest[idx]);
    }
    const seen = new Set<number>();
    return picked.filter((d) => {
        const t = d.getTime();
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
    });
}

function contractMidAndRight(
    strike: number,
    spot: number,
    call: {bid?: number; ask?: number; lastPrice: number},
    put: {bid?: number; ask?: number; lastPrice: number}
): {mid: number; right: OptionRight} | null {
    // OTM quotes are cleaner for inversion (less early-exercise premium)
    if (strike >= spot) {
        const mid = midPrice(call.bid, call.ask, call.lastPrice);
        return mid != null ? {mid, right: "call"} : null;
    }
    const mid = midPrice(put.bid, put.ask, put.lastPrice);
    return mid != null ? {mid, right: "put"} : null;
}

export async function buildIvSurface(rawSymbol: string): Promise<IvSurface> {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol || symbol.includes(".")) {
        throw new AppError(
            400,
            "UNSUPPORTED_MARKET",
            "IV surface uses US listed options (Yahoo). Try AAPL, MSFT, NVDA, SPY."
        );
    }

    const now = new Date();
    let head;
    try {
        head = await yahooFinance.options(symbol);
    } catch (err) {
        console.error("[iv] options lookup failed", symbol, err);
        throw new AppError(502, "OPTIONS_UNAVAILABLE", "Could not load the options chain from Yahoo.");
    }

    const quote = head.quote as {regularMarketPrice?: number; trailingAnnualDividendYield?: number; dividendYield?: number};
    const spot = Number(quote.regularMarketPrice);
    if (!Number.isFinite(spot) || spot <= 0) {
        throw new AppError(502, "OPTIONS_UNAVAILABLE", "Underlying price is missing.");
    }

    const rate = env.RISK_FREE_RATE;
    const q = dividendYield(quote);
    const expiries = pickExpiries(head.expirationDates ?? [], now);
    if (expiries.length === 0) {
        throw new AppError(404, "NOT_FOUND", "No future option expiries for this symbol.");
    }

    const chains = await mapPool(expiries, 3, async (expiry) => {
        try {
            return await yahooFinance.options(symbol, {date: expiry});
        } catch (err) {
            console.error("[iv] expiry fetch failed", symbol, expiry, err);
            return null;
        }
    });

    const points: IvSurfacePoint[] = [];
    let newtonCount = 0;
    let bisectionCount = 0;

    for (const chain of chains) {
        const slice = chain?.options?.[0];
        if (!slice) continue;
        const expiryDate = slice.expirationDate instanceof Date ? slice.expirationDate : new Date(slice.expirationDate);
        const ttm = yearsTo(expiryDate, now);
        if (ttm < MIN_TTM_YEARS) continue;

        const putsByStrike = new Map(slice.puts.map((p) => [p.strike, p]));
        for (const call of slice.calls) {
            const moneyness = call.strike / spot;
            if (moneyness < MIN_MONEYNESS || moneyness > MAX_MONEYNESS) continue;
            const put = putsByStrike.get(call.strike);
            if (!put) continue;
            const quoted = contractMidAndRight(call.strike, spot, call, put);
            if (!quoted || quoted.mid < MIN_MID) continue;

            const solved = impliedVol(quoted.mid, spot, call.strike, ttm, rate, q, quoted.right);
            if (!solved) continue;

            if (solved.method === "newton") newtonCount++;
            else bisectionCount++;

            const yahooRaw = quoted.right === "call" ? call.impliedVolatility : put.impliedVolatility;
            points.push({
                expiry: toDateKey(expiryDate),
                ttm,
                strike: call.strike,
                moneyness,
                iv: solved.iv,
                mid: quoted.mid,
                right: quoted.right,
                method: solved.method,
                yahooIv: Number.isFinite(yahooRaw) ? yahooRaw : null,
            });
        }
    }

    if (points.length < 8) {
        throw new AppError(
            422,
            "INSUFFICIENT_DATA",
            "Not enough liquid OTM quotes to build a surface. Try SPY or AAPL."
        );
    }

    return {
        symbol,
        spot,
        rate,
        dividendYield: q,
        asOf: now.toISOString(),
        points,
        newtonCount,
        bisectionCount,
    };
}
