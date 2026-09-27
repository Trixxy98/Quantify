import {costDrag} from "./costs";
import {walkForward} from "./walkForward";

/** French momentum: 12 months before formation to 1 month before it. That span is 11 monthly steps. */
export const FORMATION_MONTHS = 12;
export const SKIP_MONTHS = 1;
/** Month-ends the fit is allowed to see: the formation window plus the skipped month. */
export const TRAIN_MONTHS = FORMATION_MONTHS + SKIP_MONTHS;

export type MonthEnd = {month: string; date: string; index: number};

/** Last session present in each calendar month. A missing holiday is already absent from `dates`. */
export function monthEnds(dates: string[]): MonthEnd[] {
    const ends: MonthEnd[] = [];
    for (let i = 0; i < dates.length; i++) {
        const month = dates[i].slice(0, 7);
        if (i + 1 === dates.length || dates[i + 1].slice(0, 7) !== month) {
            ends.push({month, date: dates[i], index: i});
        }
    }
    return ends;
}

/**
 * Return from the close 12 months before formation to the close 1 month before it.
 * `holdingMonth` is the month the book is held. Formation is the close of the month
 * before that, and the skipped month is the one just finished, so neither the
 * holding month nor the skipped month is an input.
 */
export function momentumSignal(levels: number[], monthEndIndexes: number[], holdingMonth: number): number | null {
    const start = holdingMonth - FORMATION_MONTHS - SKIP_MONTHS;
    const end = holdingMonth - SKIP_MONTHS - 1;
    if (start < 0 || end >= monthEndIndexes.length) return null;
    const first = levels[monthEndIndexes[start]];
    const last = levels[monthEndIndexes[end]];
    if (!(first > 0) || !(last > 0)) return null;
    return last / first - 1;
}

export function topThirdCount(names: number): number {
    if (names < 1) return 0;
    return Math.max(1, Math.floor(names / 3));
}

/** Equal weight on the top third. Shorts, when asked for, are the bottom third and dollar-neutral against the longs. */
export function assignWeights(
    signals: {symbol: string; signal: number}[],
    allowShort: boolean
): Record<string, number> {
    const ranked = [...signals].sort((a, b) => b.signal - a.signal || a.symbol.localeCompare(b.symbol));
    const count = topThirdCount(ranked.length);
    if (count === 0) return {};

    const longs = ranked.slice(0, count);
    const weights: Record<string, number> = {};
    const shorts = allowShort
        ? ranked.slice(-count).filter((name) => !longs.some((long) => long.symbol === name.symbol))
        : [];

    if (shorts.length === 0) {
        for (const name of longs) weights[name.symbol] = 1 / count;
        return weights;
    }
    for (const name of longs) weights[name.symbol] = 0.5 / count;
    for (const name of shorts) weights[name.symbol] = -0.5 / shorts.length;
    return weights;
}

/** Sum of absolute weight changes. Entering from cash is 1; replacing the book is 2. */
export function weightTurnover(prev: Record<string, number>, next: Record<string, number>): number {
    const symbols = new Set([...Object.keys(prev), ...Object.keys(next)]);
    let sum = 0;
    for (const symbol of symbols) sum += Math.abs((next[symbol] ?? 0) - (prev[symbol] ?? 0));
    return sum;
}

export function momentumConclusion(strategyAnnual: number, buyHoldAnnual: number, sessions: number, names: number): string {
    const strategy = signedPct(strategyAnnual);
    const buyHold = signedPct(buyHoldAnnual);
    const gap = strategyAnnual - buyHoldAnnual;
    const verdict = Math.abs(gap) < 0.0005 ? "matches" : gap > 0 ? "beats" : "does not beat";
    const thin = names < 3 ? " With fewer than three names the top third is the whole book, so this is not a cross-sectional test." : "";
    return `12-1 momentum ${verdict} buy-and-hold after costs: ${strategy} annualized versus ${buyHold} for the same ${names}-name universe, over ${sessions} out-of-sample sessions.${thin}`;
}

function signedPct(value: number): string {
    const sign = value > 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(1)}%`;
}

export type MomentumDay = {
    date: string;
    strategy: number;
    buyHold: number;
    equalWeight: number;
    turnover: number;
};

export type MomentumRun = {
    days: MomentumDay[];
    months: {month: string; turnover: number; strategy: number; long: string[]}[];
    longCount: number;
    shortCount: number;
    latestLong: string[];
};

/**
 * Walk-forward 12-1 momentum. `levels` are total-return indexes, one row per symbol,
 * aligned to `dates`. The fit for a holding month sees only earlier month-ends.
 */
export function runMomentum(
    dates: string[],
    symbols: string[],
    levels: number[][],
    allowShort: boolean,
    commissionBps: number,
    slippageBps: number
): MomentumRun {
    const months = monthEnds(dates);
    const indexes = months.map((month) => month.index);
    const empty: MomentumRun = {days: [], months: [], longCount: 0, shortCount: 0, latestLong: []};
    if (months.length < TRAIN_MONTHS + 1 || symbols.length === 0) return empty;

    let held: Record<string, number> = {};
    let longCount = 0;
    let shortCount = 0;
    let latestLong: string[] = [];
    const days: MomentumDay[] = [];
    const monthRows: MomentumRun["months"] = [];

    walkForward(
        months.length,
        TRAIN_MONTHS,
        1,
        1,
        (_trainStart, trainEnd) => {
            const signals: {symbol: string; signal: number}[] = [];
            for (let s = 0; s < symbols.length; s++) {
                const signal = momentumSignal(levels[s], indexes, trainEnd);
                if (signal != null) signals.push({symbol: symbols[s], signal});
            }
            return assignWeights(signals, allowShort);
        },
        (target, testStart) => {
            const turnover = weightTurnover(held, target);
            const cost = costDrag(turnover, commissionBps, slippageBps);
            longCount = Object.values(target).filter((weight) => weight > 0).length;
            shortCount = Object.values(target).filter((weight) => weight < 0).length;
            latestLong = Object.entries(target).filter(([, weight]) => weight > 0).map(([symbol]) => symbol).sort();

            const month = months[testStart];
            const monthDays = dates
                .map((date, index) => ({date, index}))
                .filter((day) => day.date.slice(0, 7) === month.month && day.index > 0);

            let weights = target;
            let growth = 1;
            monthDays.forEach((day, offset) => {
                const rets = symbolReturns(levels, symbols, day.index);
                const gross = bookReturn(weights, rets);
                const net = gross - (offset === 0 ? cost : 0);
                weights = driftWeights(weights, rets, gross);
                growth *= 1 + net;
                days.push({date: day.date, strategy: net, buyHold: 0, equalWeight: 0, turnover: offset === 0 ? turnover : 0});
            });
            held = weights;
            monthRows.push({month: month.month, turnover, strategy: growth - 1, long: latestLong});
            return [growth - 1];
        }
    );

    fillComparators(dates, symbols, levels, days, commissionBps, slippageBps);
    return {days, months: monthRows, longCount, shortCount, latestLong};
}

function symbolReturns(levels: number[][], symbols: string[], index: number): Record<string, number> {
    const rets: Record<string, number> = {};
    for (let s = 0; s < symbols.length; s++) {
        const prev = levels[s][index - 1];
        rets[symbols[s]] = prev > 0 ? levels[s][index] / prev - 1 : 0;
    }
    return rets;
}

function bookReturn(weights: Record<string, number>, rets: Record<string, number>): number {
    let ret = 0;
    for (const [symbol, weight] of Object.entries(weights)) ret += weight * (rets[symbol] ?? 0);
    return ret;
}

function driftWeights(weights: Record<string, number>, rets: Record<string, number>, book: number): Record<string, number> {
    const denom = 1 + book;
    if (!(denom > 1e-8)) return weights;
    const next: Record<string, number> = {};
    for (const [symbol, weight] of Object.entries(weights)) next[symbol] = weight * (1 + (rets[symbol] ?? 0)) / denom;
    return next;
}

/** Buy-and-hold and monthly equal weight, on the same days, with the same cost schedule. */
function fillComparators(
    dates: string[],
    symbols: string[],
    levels: number[][],
    days: MomentumDay[],
    commissionBps: number,
    slippageBps: number
) {
    if (days.length === 0) return;
    const indexOf = new Map(dates.map((date, index) => [date, index]));
    const equal = Object.fromEntries(symbols.map((symbol) => [symbol, 1 / symbols.length]));
    let buyWeights = equal;
    let equalWeights = equal;
    let buyCharged = false;
    let currentMonth = "";

    for (const day of days) {
        const index = indexOf.get(day.date)!;
        const rets = symbolReturns(levels, symbols, index);
        const month = day.date.slice(0, 7);

        let buyCost = 0;
        if (!buyCharged) {
            buyCost = costDrag(weightTurnover({}, buyWeights), commissionBps, slippageBps);
            buyCharged = true;
        }
        const buyGross = bookReturn(buyWeights, rets);
        day.buyHold = buyGross - buyCost;
        buyWeights = driftWeights(buyWeights, rets, buyGross);

        let equalCost = 0;
        if (month !== currentMonth) {
            equalCost = costDrag(weightTurnover(currentMonth ? equalWeights : {}, equal), commissionBps, slippageBps);
            equalWeights = equal;
            currentMonth = month;
        }
        const equalGross = bookReturn(equalWeights, rets);
        day.equalWeight = equalGross - equalCost;
        equalWeights = driftWeights(equalWeights, rets, equalGross);
    }
}
