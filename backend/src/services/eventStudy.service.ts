import {AppError} from "../utils/AppError";
import {average, covariance, stdDev, variance} from "../utils/stats.util";
import {resolveEventDates, type EventDate, type EventType} from "./events.service";
import {yahooFinance} from "./market.service";

const BURSA_BENCHMARK = "^KLSE";
const US_BENCHMARK = "^GSPC";

// Market model is fitted on a window that stops well before the event so the
// event itself does not contaminate alpha/beta.
const ESTIMATION_LEN = 120;
const ESTIMATION_GAP = 21;
const MIN_ESTIMATION_OBS = 60;
const HISTOGRAM_BUCKETS = 15;

export type EventStudyParams = {
    symbols: string[];
    type: EventType;
    pre: number;
    post: number;
    years: number;
    hold: number;
};

export type OffsetStat = {
    offset: number;
    aar: number;
    aarSe: number;
    acar: number;
    acarSe: number;
    tStat: number;
};

export type EventRow = {
    symbol: string;
    date: string;
    label: string;
    surprisePercent: number | null;
    alpha: number;
    beta: number;
    day0Return: number;
    day0Abnormal: number;
    car: number;
};

export type DistributionStats = {
    n: number;
    mean: number;
    median: number;
    sd: number;
    p05: number;
    p95: number;
    hitRate: number;
};

export type HistogramBucket = {
    from: number;
    to: number;
    eventShare: number;
    baselineShare: number;
};

export type Trade = {
    symbol: string;
    entryDate: string;
    exitDate: string;
    ret: number;
    benchRet: number;
    excess: number;
};

export type EventStudy = {
    symbols: string[];
    eventType: EventType;
    benchmark: string;
    window: {pre: number; post: number};
    years: number;
    from: string;
    to: string;
    eventCount: number;
    skippedCount: number;
    offsets: OffsetStat[];
    events: EventRow[];
    distribution: {
        event: DistributionStats;
        baseline: DistributionStats;
        buckets: HistogramBucket[];
    };
    backtest: {
        holdDays: number;
        trades: Trade[];
        equity: {date: string; value: number}[];
        stats: {
            trades: number;
            totalReturn: number;
            meanRet: number;
            medianRet: number;
            winRate: number;
            best: number;
            worst: number;
            maxDrawdown: number;
            tStat: number;
            timeInMarketPct: number;
            buyHoldReturn: number;
        };
    };
    notes: string[];
};

type Bars = {
    keys: string[];
    close: number[];
    ret: (number | null)[];
};

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function benchmarkFor(symbols: string[]): string {
    return symbols.every((s) => s.toUpperCase().endsWith(".KL")) ? BURSA_BENCHMARK : US_BENCHMARK;
}

async function loadBars(symbol: string, from: Date): Promise<Bars> {
    let quotes: {date: Date; close: number | null}[];
    try {
        const result = await yahooFinance.chart(symbol, {period1: from, interval: "1d"});
        quotes = result.quotes as {date: Date; close: number | null}[];
    } catch (err) {
        console.error("[events] chart fetch failed", symbol, err);
        throw new AppError(502, "PRICE_UNAVAILABLE", `Could not load price history for ${symbol}.`);
    }

    const keys: string[] = [];
    const close: number[] = [];
    const seen = new Set<string>();
    for (const quote of quotes) {
        if (quote.close == null || !(quote.close > 0)) continue;
        const key = toDateKey(quote.date);
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
        close.push(quote.close);
    }

    const ret: (number | null)[] = close.map((price, i) =>
        i === 0 ? null : (price - close[i - 1]) / close[i - 1]
    );

    if (keys.length < ESTIMATION_LEN) {
        throw new AppError(
            422,
            "INSUFFICIENT_DATA",
            `Not enough price history for ${symbol} to fit a market model.`
        );
    }

    return {keys, close, ret};
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function describe(values: number[]): DistributionStats {
    if (values.length === 0) {
        return {n: 0, mean: 0, median: 0, sd: 0, p05: 0, p95: 0, hitRate: 0};
    }
    const sorted = [...values].sort((a, b) => a - b);
    return {
        n: values.length,
        mean: average(values),
        median: percentile(sorted, 0.5),
        sd: values.length > 1 ? stdDev(values) : 0,
        p05: percentile(sorted, 0.05),
        p95: percentile(sorted, 0.95),
        hitRate: values.filter((v) => v > 0).length / values.length,
    };
}

function marketModel(stock: number[], bench: number[]): {alpha: number; beta: number} | null {
    if (stock.length < MIN_ESTIMATION_OBS) return null;
    const varBench = variance(bench);
    if (!Number.isFinite(varBench) || varBench < 1e-12) return null;
    const beta = covariance(stock, bench) / varBench;
    if (!Number.isFinite(beta)) return null;
    return {alpha: average(stock) - beta * average(bench), beta};
}

/** First trading day on or after the event date: day 0 of the study window. */
function anchorIndex(keys: string[], dateKey: string): number {
    let lo = 0;
    let hi = keys.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] >= dateKey) {
            found = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return found;
}

function maxDrawdown(equity: number[]): number {
    let peak = -Infinity;
    let worst = 0;
    for (const value of equity) {
        peak = Math.max(peak, value);
        if (peak > 0) worst = Math.min(worst, value / peak - 1);
    }
    return worst;
}

function tStat(values: number[]): number {
    if (values.length < 2) return 0;
    const sd = stdDev(values);
    if (!Number.isFinite(sd) || sd < 1e-12) return 0;
    return average(values) / (sd / Math.sqrt(values.length));
}

function buildHistogram(event: number[], baseline: number[]): HistogramBucket[] {
    if (event.length === 0 || baseline.length === 0) return [];
    const sortedBaseline = [...baseline].sort((a, b) => a - b);
    const spread = Math.max(
        Math.abs(percentile(sortedBaseline, 0.01)),
        Math.abs(percentile(sortedBaseline, 0.99)),
        ...event.map((v) => Math.abs(v))
    );
    const limit = Math.max(spread, 0.01);
    const width = (2 * limit) / HISTOGRAM_BUCKETS;

    const countInto = (values: number[]) => {
        const counts = new Array(HISTOGRAM_BUCKETS).fill(0);
        for (const value of values) {
            const raw = Math.floor((value + limit) / width);
            counts[Math.min(HISTOGRAM_BUCKETS - 1, Math.max(0, raw))]++;
        }
        return counts.map((count) => count / values.length);
    };

    const eventShares = countInto(event);
    const baselineShares = countInto(baseline);

    return Array.from({length: HISTOGRAM_BUCKETS}, (_, i) => ({
        from: -limit + i * width,
        to: -limit + (i + 1) * width,
        eventShare: eventShares[i],
        baselineShare: baselineShares[i],
    }));
}

function notesFor(type: EventType, symbols: string[], benchmark: string, hold: number): string[] {
    const notes = [
        `Abnormal return = actual return minus (alpha + beta x ${benchmark}), with alpha and beta fitted on the ${ESTIMATION_LEN} trading days ending ${ESTIMATION_GAP} days before each event.`,
        "Day 0 is the first trading session on or after the event date, so an announcement made after the close lands on day 0 of the next session.",
        `The backtest buys the close of day -1 and sells the close of day +${hold}. It is one path with no costs, no slippage and no position sizing — read the per-event spread, not the curve.`,
    ];
    if (type === "EARNINGS") {
        notes.push(
            "Earnings dates come from Yahoo's 10-Q / 10-K filing list, shifted by the lag measured against the one announcement date Yahoo exposes. Yahoo does not publish historical announcement dates, so treat these as within a day of the real release."
        );
    }
    if (type === "FOMC") {
        notes.push(
            "FOMC dates are the scheduled policy decision days from federalreserve.gov. Unscheduled meetings and notation votes are excluded."
        );
    }
    if (symbols.length > 1) {
        notes.push(
            "Symbols are pooled: every event is one observation, and the equity curve compounds overlapping trades sequentially as if only one were held at a time."
        );
    }
    return notes;
}

export async function runEventStudy(params: EventStudyParams): Promise<EventStudy> {
    const symbols = [...new Set(params.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (symbols.length === 0) {
        throw new AppError(400, "VALIDATION_ERROR", "At least one symbol is required.");
    }

    const now = new Date();
    const toKey = toDateKey(now);
    const windowStart = new Date(now.getTime());
    windowStart.setUTCFullYear(windowStart.getUTCFullYear() - params.years);
    const fromKey = toDateKey(windowStart);

    // Pull extra history so the estimation window exists for the earliest event.
    const barsFrom = new Date(windowStart.getTime());
    barsFrom.setUTCFullYear(barsFrom.getUTCFullYear() - 1);

    const benchmark = benchmarkFor(symbols);
    const [eventDates, benchBars, ...symbolBars] = await Promise.all([
        resolveEventDates(params.type, symbols, fromKey, toKey),
        loadBars(benchmark, barsFrom),
        ...symbols.map((symbol) => loadBars(symbol, barsFrom)),
    ]);

    const barsBySymbol = new Map<string, Bars>(symbols.map((symbol, i) => [symbol, symbolBars[i]]));
    const benchRetByKey = new Map<string, number>();
    const benchCloseByKey = new Map<string, number>();
    benchBars.keys.forEach((key, i) => {
        const ret = benchBars.ret[i];
        if (ret != null) benchRetByKey.set(key, ret);
        benchCloseByKey.set(key, benchBars.close[i]);
    });

    const offsets = Array.from(
        {length: params.pre + params.post + 1},
        (_, i) => i - params.pre
    );

    const arByOffset = new Map<number, number[]>(offsets.map((offset) => [offset, []]));
    const carByOffset = new Map<number, number[]>(offsets.map((offset) => [offset, []]));
    const events: EventRow[] = [];
    const trades: Trade[] = [];
    const eventDayReturns: number[] = [];
    const excludedBySymbol = new Map<string, Set<number>>(symbols.map((s) => [s, new Set<number>()]));
    let skippedCount = 0;

    const usableEvents: {event: EventDate; bars: Bars; anchor: number}[] = [];
    for (const event of eventDates) {
        const bars = barsBySymbol.get(event.symbol);
        if (!bars) {
            skippedCount++;
            continue;
        }
        const anchor = anchorIndex(bars.keys, event.date);
        const estimationEnd = anchor - ESTIMATION_GAP;
        if (
            anchor < 0 ||
            anchor - params.pre < 1 ||
            anchor + params.post >= bars.keys.length ||
            estimationEnd - MIN_ESTIMATION_OBS < 1
        ) {
            skippedCount++;
            continue;
        }
        usableEvents.push({event, bars, anchor});
    }

    for (const {event, bars, anchor} of usableEvents) {
        const estimationEnd = anchor - ESTIMATION_GAP;
        const estimationStart = Math.max(1, estimationEnd - ESTIMATION_LEN);
        const stockEstimation: number[] = [];
        const benchEstimation: number[] = [];
        for (let i = estimationStart; i < estimationEnd; i++) {
            const stockRet = bars.ret[i];
            const benchRet = benchRetByKey.get(bars.keys[i]);
            if (stockRet == null || benchRet == null) continue;
            stockEstimation.push(stockRet);
            benchEstimation.push(benchRet);
        }

        const model = marketModel(stockEstimation, benchEstimation);
        if (!model) {
            skippedCount++;
            continue;
        }

        // Build the whole path first: a half-filled window would leave the offsets
        // with different sample sizes.
        const path: {offset: number; index: number; abnormal: number; actual: number}[] = [];
        for (const offset of offsets) {
            const i = anchor + offset;
            const stockRet = bars.ret[i];
            const benchRet = benchRetByKey.get(bars.keys[i]);
            if (stockRet == null || benchRet == null) break;
            path.push({
                offset,
                index: i,
                abnormal: stockRet - (model.alpha + model.beta * benchRet),
                actual: stockRet,
            });
        }

        if (path.length !== offsets.length) {
            skippedCount++;
            continue;
        }

        const excluded = excludedBySymbol.get(event.symbol)!;
        let car = 0;
        let day0Return = 0;
        let day0Abnormal = 0;
        for (const step of path) {
            car += step.abnormal;
            arByOffset.get(step.offset)!.push(step.abnormal);
            carByOffset.get(step.offset)!.push(car);
            excluded.add(step.index);
            if (step.offset === 0) {
                day0Return = step.actual;
                day0Abnormal = step.abnormal;
            }
        }

        eventDayReturns.push(day0Return);
        events.push({
            symbol: event.symbol,
            date: event.date,
            label: event.label,
            surprisePercent: event.surprisePercent,
            alpha: model.alpha,
            beta: model.beta,
            day0Return,
            day0Abnormal,
            car,
        });

        const entry = anchor - 1;
        const exit = anchor + params.hold;
        if (entry >= 0 && exit < bars.keys.length) {
            const ret = bars.close[exit] / bars.close[entry] - 1;
            const benchEntry = benchCloseByKey.get(bars.keys[entry]);
            const benchExit = benchCloseByKey.get(bars.keys[exit]);
            const benchRet = benchEntry != null && benchExit != null ? benchExit / benchEntry - 1 : 0;
            trades.push({
                symbol: event.symbol,
                entryDate: bars.keys[entry],
                exitDate: bars.keys[exit],
                ret,
                benchRet,
                excess: ret - benchRet,
            });
        }
    }

    if (events.length === 0) {
        throw new AppError(
            422,
            "INSUFFICIENT_DATA",
            "No event had both a full window and a clean estimation period. Try a shorter window or a longer history."
        );
    }

    const offsetStats: OffsetStat[] = offsets.map((offset) => {
        const ar = arByOffset.get(offset)!;
        const carPath = carByOffset.get(offset)!;
        const aarSe = ar.length > 1 ? stdDev(ar) / Math.sqrt(ar.length) : 0;
        const acarSe = carPath.length > 1 ? stdDev(carPath) / Math.sqrt(carPath.length) : 0;
        const acar = carPath.length > 0 ? average(carPath) : 0;
        return {
            offset,
            aar: ar.length > 0 ? average(ar) : 0,
            aarSe,
            acar,
            acarSe,
            tStat: acarSe > 1e-12 ? acar / acarSe : 0,
        };
    });

    const baselineReturns: number[] = [];
    let tradingDays = 0;
    let buyHoldSum = 0;
    for (const symbol of symbols) {
        const bars = barsBySymbol.get(symbol)!;
        const excluded = excludedBySymbol.get(symbol)!;
        let firstClose: number | null = null;
        let lastClose: number | null = null;
        for (let i = 1; i < bars.keys.length; i++) {
            if (bars.keys[i] < fromKey) continue;
            tradingDays++;
            if (firstClose == null) firstClose = bars.close[i - 1];
            lastClose = bars.close[i];
            const ret = bars.ret[i];
            if (ret != null && !excluded.has(i)) baselineReturns.push(ret);
        }
        if (firstClose != null && lastClose != null && firstClose > 0) {
            buyHoldSum += lastClose / firstClose - 1;
        }
    }

    trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.symbol.localeCompare(b.symbol));
    const equity: {date: string; value: number}[] = [];
    let value = 100;
    if (trades.length > 0) {
        equity.push({date: trades[0].entryDate, value});
        for (const trade of trades) {
            value *= 1 + trade.ret;
            equity.push({date: trade.exitDate, value});
        }
    }

    const tradeReturns = trades.map((t) => t.ret);
    const sortedTradeReturns = [...tradeReturns].sort((a, b) => a - b);

    return {
        symbols,
        eventType: params.type,
        benchmark,
        window: {pre: params.pre, post: params.post},
        years: params.years,
        from: fromKey,
        to: toKey,
        eventCount: events.length,
        skippedCount,
        offsets: offsetStats,
        events,
        distribution: {
            event: describe(eventDayReturns),
            baseline: describe(baselineReturns),
            buckets: buildHistogram(eventDayReturns, baselineReturns),
        },
        backtest: {
            holdDays: params.hold,
            trades,
            equity,
            stats: {
                trades: trades.length,
                totalReturn: value / 100 - 1,
                meanRet: tradeReturns.length > 0 ? average(tradeReturns) : 0,
                medianRet: percentile(sortedTradeReturns, 0.5),
                winRate:
                    tradeReturns.length > 0
                        ? tradeReturns.filter((r) => r > 0).length / tradeReturns.length
                        : 0,
                best: sortedTradeReturns.length > 0 ? sortedTradeReturns[sortedTradeReturns.length - 1] : 0,
                worst: sortedTradeReturns.length > 0 ? sortedTradeReturns[0] : 0,
                maxDrawdown: maxDrawdown(equity.map((point) => point.value)),
                tStat: tStat(tradeReturns),
                timeInMarketPct:
                    tradingDays > 0 ? (trades.length * (params.hold + 1)) / tradingDays : 0,
                buyHoldReturn: symbols.length > 0 ? buyHoldSum / symbols.length : 0,
            },
        },
        notes: notesFor(params.type, symbols, benchmark, params.hold),
    };
}
