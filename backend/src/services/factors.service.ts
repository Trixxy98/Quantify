import {inflateRawSync} from "node:zlib";
import {TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {type Range, resolveRangeStart, toDateKey} from "../utils/dateRange";
import {adjustTrade, loadDividends, loadSplits} from "./corporateActions";
import {latestAtOrBefore, type SeriesPoint} from "./fx";
import {getOwnedPortfolio} from "./portfolio.service";
import {ols} from "../research/ols";
import {FACTOR_NAMES, FF5_URL, MOMENTUM_URL, parseFrenchDaily, type FrenchRow} from "../research/french";

const HAC_LAG = 5;
const MIN_OBSERVATIONS = 120;
const ROLLING = 252;
const ANNUALIZATION = 252;
/** Re-download when the stored tail is older than this. French publishes monthly. */
const REFRESH_AFTER_DAYS = 7;
/** Say so when the tail is older than this. A monthly publication plus a week of delay. */
const STALE_AFTER_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FactorLoading = {factor: string; beta: number; se: number; tStat: number};

export type FactorExposure = {
    symbols: string[];
    n: number;
    dataThrough: string | null;
    alpha: number | null;
    alphaSe: number | null;
    alphaT: number | null;
    rSquared: number | null;
    loadings: FactorLoading[] | null;
    rolling: {date: string; alpha: number; loadings: {factor: string; beta: number}[]}[];
    notes: string[];
};

type DatedReturn = {date: string; ret: number};

function unzipFirst(buf: Buffer): string {
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("Ken French download was not a zip file");
    const method = buf.readUInt16LE(8);
    const compressed = buf.readUInt32LE(18);
    const nameLength = buf.readUInt16LE(26);
    const extraLength = buf.readUInt16LE(28);
    const start = 30 + nameLength + extraLength;
    const data = buf.subarray(start, start + compressed);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (!raw) throw new Error(`Unsupported zip method ${method}`);
    return raw.toString("utf8");
}

async function downloadCsv(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Ken French download failed (${response.status}) for ${url}`);
    return unzipFirst(Buffer.from(await response.arrayBuffer()));
}

export async function refreshFactors(): Promise<{rows: number; through: string | null}> {
    const [ff5, momentum] = await Promise.all([
        downloadCsv(FF5_URL).then(parseFrenchDaily),
        downloadCsv(MOMENTUM_URL).then(parseFrenchDaily),
    ]);

    const byDate = new Map<string, Record<string, number>>();
    const absorb = (rows: FrenchRow[]) => {
        for (const row of rows) {
            const current = byDate.get(row.date) ?? {};
            Object.assign(current, row.values);
            byDate.set(row.date, current);
        }
    };
    absorb(ff5);
    absorb(momentum);

    const data = [...byDate.entries()].flatMap(([date, values]) =>
        Object.entries(values).map(([factor, value]) => ({
            date: new Date(`${date}T00:00:00.000Z`),
            factor,
            value,
        }))
    );

    await prisma.factorReturn.deleteMany();
    const chunk = 5000;
    for (let i = 0; i < data.length; i += chunk) {
        await prisma.factorReturn.createMany({data: data.slice(i, i + chunk)});
    }

    const through = [...byDate.keys()].sort().at(-1) ?? null;
    console.log(`[factors] stored ${data.length} rows through ${through}`);
    return {rows: data.length, through};
}

/** Downloads only when the table is empty or the tail is older than a week. */
export async function refreshFactorsIfStale(): Promise<{refreshed: boolean; through: string | null}> {
    const latest = await prisma.factorReturn.findFirst({orderBy: {date: "desc"}, select: {date: true}});
    const age = latest ? (Date.now() - latest.date.getTime()) / DAY_MS : Infinity;
    if (age < REFRESH_AFTER_DAYS) return {refreshed: false, through: latest ? toDateKey(latest.date) : null};
    try {
        const result = await refreshFactors();
        return {refreshed: true, through: result.through};
    } catch (err) {
        console.error("[factors] refresh failed", err);
        return {refreshed: false, through: latest ? toDateKey(latest.date) : null};
    }
}

/**
 * Daily time-weighted return of the US names only, in USD. Bursa holdings are
 * left out: these factors were estimated on US stocks, and converting the
 * sleeve to MYR would mix the ringgit into the alpha.
 */
async function usSleeveReturns(portfolioId: string): Promise<{symbols: string[]; returns: DatedReturn[]}> {
    const transactions = await prisma.transaction.findMany({
        where: {portfolioId},
        orderBy: [{date: "asc"}, {createdAt: "asc"}],
    });
    const us = transactions.filter((tx) => !tx.symbol.includes("."));
    const symbols = [...new Set(us.map((tx) => tx.symbol))].sort();
    if (symbols.length === 0) return {symbols, returns: []};

    const [prices, splitsBySymbol, dividendsBySymbol] = await Promise.all([
        prisma.dailyPrice.findMany({
            where: {symbol: {in: symbols}, date: {gte: us[0].date}},
            orderBy: {date: "asc"},
        }),
        loadSplits(symbols),
        loadDividends(symbols),
    ]);

    const priceMap = new Map<string, SeriesPoint[]>();
    const calendar = new Set<number>();
    for (const price of prices) {
        const time = price.date.getTime();
        calendar.add(time);
        const series = priceMap.get(price.symbol) ?? [];
        series.push({date: time, close: Number(price.close)});
        priceMap.set(price.symbol, series);
    }
    const days = [...calendar].sort((a, b) => a - b);
    if (days.length === 0) return {symbols, returns: []};

    const dividends = [...dividendsBySymbol.entries()].flatMap(([symbol, rows]) =>
        rows.map((row) => ({time: row.exDate.getTime(), symbol, amount: row.amount}))
    );
    dividends.sort((a, b) => a.time - b.time);

    const qty = new Map<string, number>();
    let txIndex = 0;
    let divIndex = 0;
    const points: {date: string; value: number; cashFlow: number; income: number}[] = [];

    for (const time of days) {
        let cashFlow = 0;
        while (txIndex < us.length && us[txIndex].date.getTime() <= time) {
            const tx = us[txIndex];
            const {quantity} = adjustTrade(
                Number(tx.quantity),
                Number(tx.price),
                splitsBySymbol.get(tx.symbol) ?? [],
                tx.date.getTime()
            );
            const notional = Number(tx.quantity) * Number(tx.price);
            const fee = Number(tx.fee);
            cashFlow += tx.type === TransactionType.BUY ? notional + fee : -(notional - fee);
            qty.set(tx.symbol, (qty.get(tx.symbol) ?? 0) + (tx.type === TransactionType.BUY ? quantity : -quantity));
            txIndex++;
        }

        let income = 0;
        while (divIndex < dividends.length && dividends[divIndex].time <= time) {
            const event = dividends[divIndex];
            const held = qty.get(event.symbol) ?? 0;
            if (held > 0) income += held * event.amount;
            divIndex++;
        }

        let value = 0;
        for (const symbol of symbols) {
            const held = qty.get(symbol) ?? 0;
            if (held <= 0) continue;
            const close = latestAtOrBefore(priceMap.get(symbol) ?? [], time);
            if (close != null) value += held * close;
        }
        points.push({date: toDateKey(new Date(time)), value, cashFlow, income});
    }

    const returns: DatedReturn[] = [];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1].value;
        if (!(prev > 1e-6)) continue;
        const ret = (points[i].value - prev - points[i].cashFlow + points[i].income) / prev;
        returns.push({date: points[i].date, ret});
    }
    return {symbols, returns};
}

type Aligned = {date: string; y: number; x: number[]};

function annualizedAlpha(daily: number): number {
    return daily * ANNUALIZATION;
}

function annualizedAlphaSe(dailySe: number): number {
    // A coefficient scales with its standard error. √252 is for a volatility, not for this.
    return dailySe * ANNUALIZATION;
}

export async function getFactorExposure(portfolioId: string, userId: string, range: Range): Promise<FactorExposure> {
    await getOwnedPortfolio(portfolioId, userId);
    const notes = [
        "US holdings only, measured in USD. Bursa names are excluded: these factors were estimated on US stocks, and converting the sleeve to ringgit would book the currency as alpha.",
        "Alpha is the annualized intercept (daily × 252) and its standard error scales by 252 as well, so the t-statistic is unchanged. t-statistics use Newey–West standard errors with 5 lags.",
        "Backtests built on this will charge 5 bps commission and 5 bps slippage per unit of turnover.",
    ];

    const latest = await prisma.factorReturn.findFirst({orderBy: {date: "desc"}, select: {date: true}});
    const dataThrough = latest ? toDateKey(latest.date) : null;
    const {symbols, returns} = await usSleeveReturns(portfolioId);

    const empty: FactorExposure = {
        symbols,
        n: 0,
        dataThrough,
        alpha: null,
        alphaSe: null,
        alphaT: null,
        rSquared: null,
        loadings: null,
        rolling: [],
        notes,
    };
    if (symbols.length === 0) {
        notes.push("This portfolio has no US holdings, so there is nothing to regress.");
        return empty;
    }
    if (!dataThrough) {
        notes.push("No factor data stored yet. Run npm run factors:refresh on the API.");
        return empty;
    }

    const start = resolveRangeStart(range);
    const factorFrom = start ? new Date(start.getTime() - 420 * DAY_MS) : null;
    const rows = await prisma.factorReturn.findMany({
        where: factorFrom ? {date: {gte: factorFrom}} : {},
        orderBy: {date: "asc"},
    });
    const byDate = new Map<string, Map<string, number>>();
    for (const row of rows) {
        const key = toDateKey(row.date);
        const factors = byDate.get(key) ?? new Map<string, number>();
        factors.set(row.factor, Number(row.value));
        byDate.set(key, factors);
    }

    const aligned: Aligned[] = [];
    for (const point of returns) {
        const factors = byDate.get(point.date);
        if (!factors) continue;
        const rf = factors.get("RF");
        const x = FACTOR_NAMES.map((name) => factors.get(name));
        if (rf == null || x.some((value) => value == null)) continue;
        aligned.push({date: point.date, y: point.ret - rf, x: x as number[]});
    }

    const startKey = start ? toDateKey(start) : null;
    const sample = startKey ? aligned.filter((row) => row.date >= startKey) : aligned;
    const ageDays = (Date.now() - latest!.date.getTime()) / DAY_MS;
    if (ageDays > STALE_AFTER_DAYS) {
        notes.push(`Ken French data runs through ${dataThrough} and is published monthly, so the last few weeks are not in the regression.`);
    } else {
        notes.push(`Ken French data runs through ${dataThrough}.`);
    }
    notes.push(`Regressed on ${symbols.join(", ")}.`);

    if (sample.length < MIN_OBSERVATIONS) {
        notes.push(`Loadings need ${MIN_OBSERVATIONS} overlapping sessions; this range has ${sample.length}.`);
        return {...empty, n: sample.length, notes};
    }

    const fit = ols(
        sample.map((row) => row.y),
        sample.map((row) => row.x),
        HAC_LAG
    );
    const loadings = FACTOR_NAMES.map((factor, i) => ({
        factor,
        beta: fit.beta[i + 1],
        se: fit.se[i + 1],
        tStat: fit.tStat[i + 1],
    }));

    const rolling: FactorExposure["rolling"] = [];
    for (let end = ROLLING - 1; end < aligned.length; end++) {
        const date = aligned[end].date;
        if (startKey && date < startKey) continue;
        const window = aligned.slice(end - ROLLING + 1, end + 1);
        try {
            const rolled = ols(
                window.map((row) => row.y),
                window.map((row) => row.x),
                HAC_LAG
            );
            rolling.push({
                date,
                alpha: annualizedAlpha(rolled.beta[0]),
                loadings: FACTOR_NAMES.map((factor, i) => ({factor, beta: rolled.beta[i + 1]})),
            });
        } catch (err) {
            if (!(err instanceof Error) || !err.message.includes("collinear")) throw err;
        }
    }
    if (rolling.length === 0) {
        notes.push(`Rolling loadings need ${ROLLING} sessions of history before each point.`);
    } else {
        notes.push("Each rolling point uses the trailing 252 sessions, which can start before the selected range.");
    }

    return {
        symbols,
        n: fit.n,
        dataThrough,
        alpha: annualizedAlpha(fit.beta[0]),
        alphaSe: annualizedAlphaSe(fit.se[0]),
        alphaT: fit.tStat[0],
        rSquared: fit.rSquared,
        loadings,
        rolling,
        notes,
    };
}
