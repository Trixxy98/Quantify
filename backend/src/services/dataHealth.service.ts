import {Currency} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {IN_FLIGHT_MS} from "../jobs/sync.job";
import {latestSession, type Market} from "../jobs/marketSession";
import {toDateKey} from "../utils/dateRange";
import {
    assessIvRecording,
    assessPriceSeries,
    type HealthStatus,
    type IvAssessment,
    type PriceAssessment,
    statusRank,
    tradedCalendar,
    weekdaysAfter,
    worst,
} from "./dataHealth.math";
import {BENCHMARK_SYMBOLS} from "./market.service";

const US_CALENDAR = "^GSPC";
const BURSA_CALENDAR = "^KLSE";
const FX_LABEL = "USD/MYR";
const IV_ALWAYS = ["SPY"];

export type DataHealthRow = Omit<PriceAssessment, "status" | "issues"> & {
    symbol: string;
    kind: "holding" | "benchmark" | "fx" | "options";
    market: Market | null;
    splits: number;
    dividends: number;
    iv: Omit<IvAssessment, "status" | "issues"> | null;
    status: HealthStatus;
    issues: string[];
};

type SyncRunView = {trigger: string; startedAt: string; finishedAt: string | null; ok: boolean; error: string | null};

export type DataHealth = {
    generatedAt: string;
    expected: Record<Market, string>;
    sync: {
        status: HealthStatus;
        issues: string[];
        lastOk: SyncRunView | null;
        inFlightSince: string | null;
        latestByTrigger: SyncRunView[];
    };
    counts: Record<HealthStatus, number>;
    rows: DataHealthRow[];
    notes: string[];
};

function marketOf(symbol: string): Market {
    return symbol === BURSA_CALENDAR || symbol.toUpperCase().endsWith(".KL") ? "BURSA" : "US";
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const k = key(row);
        const list = groups.get(k);
        if (list) list.push(row);
        else groups.set(k, [row]);
    }
    return groups;
}

function runView(run: {trigger: string; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null}): SyncRunView {
    return {
        trigger: run.trigger,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        ok: run.ok,
        error: run.error,
    };
}

const EMPTY_PRICES: Omit<PriceAssessment, "status" | "issues"> = {
    bars: 0,
    firstDate: null,
    lastDate: null,
    staleSessions: null,
    missingSessions: 0,
    missingRecent: [],
    weekendRows: 0,
    splitCliffs: [],
    dividendsWithoutBar: [],
};

function row(
    symbol: string,
    kind: DataHealthRow["kind"],
    market: Market | null,
    prices: PriceAssessment | null,
    iv: IvAssessment | null,
    extra: {splits?: number; dividends?: number} = {}
): DataHealthRow {
    const {status: priceStatus, issues: priceIssues, ...priceFields} = prices ?? {...EMPTY_PRICES, status: "ok", issues: []};
    const ivFields = iv ? (({status: _status, issues: _issues, ...rest}) => rest)(iv) : null;
    return {
        symbol,
        kind,
        market,
        ...priceFields,
        splits: extra.splits ?? 0,
        dividends: extra.dividends ?? 0,
        iv: ivFields,
        status: worst([priceStatus, iv?.status ?? "ok"]),
        issues: [...priceIssues, ...(iv?.issues ?? [])],
    };
}

async function syncHealth(expectedUs: string, now: Date): Promise<DataHealth["sync"]> {
    const [lastOk, latestByTrigger, inFlight] = await Promise.all([
        prisma.syncRun.findFirst({where: {ok: true}, orderBy: {finishedAt: "desc"}}),
        prisma.syncRun.findMany({orderBy: {startedAt: "desc"}, distinct: ["trigger"]}),
        prisma.syncRun.findFirst({
            where: {finishedAt: null, startedAt: {gte: new Date(now.getTime() - IN_FLIGHT_MS)}},
            orderBy: {startedAt: "desc"},
        }),
    ]);

    const issues: string[] = [];
    const statuses: HealthStatus[] = [];
    if (!lastOk?.finishedAt) {
        statuses.push("bad");
        issues.push("No successful sync recorded. Press Sync or run npm run sync:daily.");
    } else {
        const coveredThrough = latestSession(lastOk.finishedAt, "US").date;
        const behind = weekdaysAfter(coveredThrough, expectedUs);
        statuses.push(behind === 0 ? "ok" : behind === 1 ? "warn" : "bad");
        if (behind > 0) {
            issues.push(`Last successful sync covered the ${coveredThrough} US session, ${behind} behind ${expectedUs}.`);
        }
    }
    const latestRun = latestByTrigger[0];
    if (latestRun?.finishedAt && !latestRun.ok) {
        statuses.push("warn");
        issues.push(`Latest ${latestRun.trigger} sync failed: ${latestRun.error ?? "unknown error"}.`);
    }

    return {
        status: worst(statuses),
        issues,
        lastOk: lastOk ? runView(lastOk) : null,
        inFlightSince: inFlight?.startedAt.toISOString() ?? null,
        latestByTrigger: latestByTrigger.map(runView),
    };
}

/**
 * One row per series the user's numbers depend on: each traded symbol, the
 * benchmarks, USD/MYR, and the recorded implied vol. Market data is shared, so
 * only the caller's own symbols are listed.
 */
export async function getDataHealth(userId: string, now = new Date()): Promise<DataHealth> {
    const expected: Record<Market, string> = {
        US: latestSession(now, "US").date,
        BURSA: latestSession(now, "BURSA").date,
    };

    const traded = await prisma.transaction.findMany({
        where: {portfolio: {userId}},
        select: {symbol: true},
        distinct: ["symbol"],
    });
    const symbols = traded.map((t) => t.symbol).sort();
    const usSymbols = symbols.filter((symbol) => marketOf(symbol) === "US");
    const ivSymbols = [...new Set([...usSymbols, ...IV_ALWAYS])];

    const [prices, benchmarks, splits, dividends, fx, implied, sync] = await Promise.all([
        prisma.dailyPrice.findMany({
            where: {symbol: {in: symbols}},
            orderBy: [{symbol: "asc"}, {date: "asc"}],
            select: {symbol: true, date: true, close: true},
        }),
        prisma.benchmarkPrice.findMany({
            where: {symbol: {in: BENCHMARK_SYMBOLS}},
            orderBy: [{symbol: "asc"}, {date: "asc"}],
            select: {symbol: true, date: true, close: true},
        }),
        prisma.stockSplit.findMany({where: {symbol: {in: symbols}}, orderBy: {date: "asc"}}),
        prisma.dividend.findMany({where: {symbol: {in: symbols}}, orderBy: {exDate: "asc"}, select: {symbol: true, exDate: true}}),
        prisma.exchangeRate.findMany({
            where: {from: Currency.USD, to: Currency.MYR},
            orderBy: {date: "asc"},
            select: {date: true, rate: true},
        }),
        prisma.impliedSnapshot.findMany({where: {symbol: {in: ivSymbols}}, select: {symbol: true, date: true}}),
        syncHealth(expected.US, now),
    ]);

    const toBars = (list: {date: Date; close: unknown}[]) => list.map((p) => ({date: toDateKey(p.date), close: Number(p.close)}));
    const benchmarkBars = new Map([...groupBy(benchmarks, (b) => b.symbol)].map(([symbol, list]) => [symbol, toBars(list)]));
    const pricesBySymbol = groupBy(prices, (p) => p.symbol);
    const notes: string[] = [];
    const calendarFor = (market: Market, index: string): string[] => {
        const indexDates = (benchmarkBars.get(index) ?? []).map((bar) => bar.date);
        const series = symbols
            .filter((symbol) => marketOf(symbol) === market)
            .map((symbol) => new Set((pricesBySymbol.get(symbol) ?? []).map((p) => toDateKey(p.date))));
        const {calendar, dropped} = tradedCalendar(indexDates, series);
        if (dropped.length > 0) {
            notes.push(
                `${index} has a bar on ${dropped.join(", ")} but none of your ${market === "US" ? "US" : "Bursa"} names traded; treated as a holiday.`
            );
        }
        return calendar;
    };
    const calendars: Record<Market, string[]> = {
        US: calendarFor("US", US_CALENDAR),
        BURSA: calendarFor("BURSA", BURSA_CALENDAR),
    };
    const splitsBySymbol = groupBy(splits, (s) => s.symbol);
    const dividendsBySymbol = groupBy(dividends, (d) => d.symbol);
    const ivBySymbol = groupBy(implied, (i) => i.symbol);

    const ivFor = (symbol: string) =>
        assessIvRecording({
            recorded: (ivBySymbol.get(symbol) ?? []).map((i) => toDateKey(i.date)),
            calendar: calendars.US,
            expected: expected.US,
        });

    const rows: DataHealthRow[] = [];

    for (const symbol of symbols) {
        const market = marketOf(symbol);
        const symbolSplits = (splitsBySymbol.get(symbol) ?? []).map((s) => ({
            date: toDateKey(s.date),
            numerator: s.numerator,
            denominator: s.denominator,
        }));
        const exDates = (dividendsBySymbol.get(symbol) ?? []).map((d) => toDateKey(d.exDate));
        const assessment = assessPriceSeries({
            bars: toBars(pricesBySymbol.get(symbol) ?? []),
            calendar: calendars[market],
            expected: expected[market],
            splits: symbolSplits,
            exDates,
        });
        rows.push(
            row(symbol, "holding", market, assessment, market === "US" ? ivFor(symbol) : null, {
                splits: symbolSplits.length,
                dividends: exDates.length,
            })
        );
    }

    for (const symbol of BENCHMARK_SYMBOLS) {
        const market = marketOf(symbol);
        const isCalendar = symbol === US_CALENDAR || symbol === BURSA_CALENDAR;
        const assessment = assessPriceSeries({
            bars: benchmarkBars.get(symbol) ?? [],
            calendar: calendars[market],
            expected: expected[market],
            isCalendar,
        });
        rows.push(row(symbol, "benchmark", market, assessment, null));
    }

    // FX is needed on any day either market trades, so it is checked against both calendars.
    const fxCalendar = [...new Set([...calendars.US, ...calendars.BURSA])].sort();
    const fxExpected = expected.US > expected.BURSA ? expected.US : expected.BURSA;
    rows.push(
        row(
            FX_LABEL,
            "fx",
            null,
            assessPriceSeries({
                bars: fx.map((r) => ({date: toDateKey(r.date), close: Number(r.rate)})),
                calendar: fxCalendar,
                expected: fxExpected,
            }),
            null
        )
    );

    for (const symbol of IV_ALWAYS) {
        if (!symbols.includes(symbol)) rows.push(row(symbol, "options", "US", null, ivFor(symbol)));
    }

    rows.sort((a, b) => statusRank(b.status) - statusRank(a.status) || a.symbol.localeCompare(b.symbol));

    const counts: Record<HealthStatus, number> = {ok: 0, warn: 0, bad: 0};
    for (const r of rows) counts[r.status] += 1;

    return {
        generatedAt: now.toISOString(),
        expected,
        sync,
        counts,
        rows,
        notes: [
            ...notes,
            `Exchange calendars come from ${US_CALENDAR} and ${BURSA_CALENDAR} bars, so holidays are known only once the index skips them. Until then a holiday reads as one session behind.`,
            "Implied-vol gaps cannot be backfilled: Yahoo serves only the current chain. Only gaps in the last 20 US sessions colour a row.",
        ],
    };
}
