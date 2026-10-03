import basketFile from "../data/momentumBasket.json";
import {env} from "../config/env";
import {prisma} from "../lib/prisma";
import {AppError} from "../utils/AppError";
import {toDateKey} from "../utils/dateRange";
import {loadDividends} from "./corporateActions";
import {syncDailyPrices} from "./market.service";
import {getOwnedPortfolio} from "./portfolio.service";
import {
    annualizedReturn,
    maxDrawdown,
    sharpeRatio,
    sharpeStandardError,
    volatility,
    type DailyValue,
} from "./metrics.service";
import {FACTOR_NAMES} from "../research/french";
import {momentumConclusion, runMomentum, type MomentumDay} from "../research/momentum";
import {ols} from "../research/ols";
import {BOOTSTRAP_BLOCK_LENGTH, BOOTSTRAP_RESAMPLES, stationaryBootstrap, type Interval} from "../research/bootstrap";

const MIN_BARS = 400;
const HISTORY_FROM = new Date("2015-01-01T00:00:00.000Z");
const BENCHMARK = "^SP500TR";
const PRICE_BENCHMARK = "^GSPC";

export type MomentumStats = {
    annualizedReturn: number;
    volatility: number;
    sharpe: number;
    sharpeSe: number;
    sharpeInterval: Interval | null;
    maxDrawdown: number;
    hitRate: number | null;
    avgTurnover: number | null;
};

export type MomentumStudy = {
    universe: "holdings" | "basket";
    basketAsOf: string | null;
    symbols: string[];
    allowShort: boolean;
    commissionBps: number;
    slippageBps: number;
    longCount: number;
    shortCount: number;
    latestLong: string[];
    conclusion: string;
    from: string | null;
    to: string | null;
    n: number;
    strategy: MomentumStats | null;
    buyHold: MomentumStats | null;
    equalWeight: MomentumStats | null;
    benchmark: MomentumStats | null;
    benchmarkSymbol: string | null;
    alpha: {annualized: number; se: number; tStat: number; n: number} | null;
    equity: {date: string; strategy: number; buyHold: number; equalWeight: number; benchmark: number | null}[];
    excess: {date: string; value: number}[];
    turnover: {month: string; turnover: number}[];
    notes: string[];
};

const inflight = new Map<string, Promise<void>>();

async function ensureHistory(symbols: string[]): Promise<string[]> {
    const counts = await prisma.dailyPrice.groupBy({
        by: ["symbol"],
        where: {symbol: {in: symbols}},
        _count: {_all: true},
    });
    const have = new Map(counts.map((row) => [row.symbol, row._count._all]));
    const thin = symbols.filter((symbol) => (have.get(symbol) ?? 0) < MIN_BARS);
    const failed: string[] = [];

    let next = 0;
    async function worker() {
        while (next < thin.length) {
            const symbol = thin[next++];
            const pending = inflight.get(symbol);
            if (pending) {
                await pending;
                continue;
            }
            const job = syncDailyPrices(symbol, HISTORY_FROM)
                .catch((err) => {
                    console.error("[momentum] price sync failed", symbol, err);
                    failed.push(symbol);
                })
                .finally(() => inflight.delete(symbol));
            inflight.set(symbol, job);
            await job;
        }
    }
    await Promise.all(Array.from({length: Math.min(3, thin.length)}, () => worker()));
    return failed;
}

export function buildLevel(
    closes: {date: string; close: number}[],
    dividends: {date: string; amount: number}[]
): {date: string; level: number}[] {
    if (closes.length === 0) return [];
    const income = new Map(dividends.map((row) => [row.date, row.amount]));
    let level = 100;
    const out = [{date: closes[0].date, level}];
    for (let i = 1; i < closes.length; i++) {
        const prev = closes[i - 1].close;
        if (prev > 0) level *= (closes[i].close + (income.get(closes[i].date) ?? 0)) / prev;
        out.push({date: closes[i].date, level});
    }
    return out;
}

function align(series: {date: string; level: number}[][]): {dates: string[]; levels: number[][]} {
    const start = series.reduce((latest, row) => (row[0].date > latest ? row[0].date : latest), series[0][0].date);
    const calendar = new Set<string>();
    for (const row of series) {
        for (const point of row) {
            if (point.date >= start) calendar.add(point.date);
        }
    }
    const dates = [...calendar].sort();
    const levels = series.map((row) => {
        const out: number[] = [];
        let cursor = 0;
        let last = row[0].level;
        for (const date of dates) {
            while (cursor < row.length && row[cursor].date <= date) {
                last = row[cursor].level;
                cursor++;
            }
            out.push(last);
        }
        return out;
    });
    return {dates, levels};
}

function stats(returns: number[], monthly: number[], turnovers: number[] | null): MomentumStats {
    const equity: DailyValue[] = [];
    let value = 100;
    returns.forEach((ret, index) => {
        value *= 1 + ret;
        equity.push({date: String(index), value});
    });
    return {
        annualizedReturn: annualizedReturn(returns),
        volatility: volatility(returns),
        sharpe: sharpeRatio(returns, env.RISK_FREE_RATE),
        sharpeSe: sharpeStandardError(returns, env.RISK_FREE_RATE),
        sharpeInterval: stationaryBootstrap(returns, {sharpe: (sample) => sharpeRatio(sample, env.RISK_FREE_RATE)}).sharpe,
        maxDrawdown: maxDrawdown(equity),
        hitRate: monthly.length === 0 ? null : monthly.filter((ret) => ret > 0).length / monthly.length,
        avgTurnover: turnovers === null || turnovers.length === 0 ? null : turnovers.reduce((sum, value) => sum + value, 0) / turnovers.length,
    };
}

function monthlyReturns(days: MomentumDay[], pick: (day: MomentumDay) => number): number[] {
    const groups = new Map<string, number>();
    for (const day of days) {
        const month = day.date.slice(0, 7);
        groups.set(month, (groups.get(month) ?? 1) * (1 + pick(day)));
    }
    return [...groups.values()].map((growth) => growth - 1);
}

function rollingExcess(days: MomentumDay[]): {date: string; value: number}[] {
    const out: {date: string; value: number}[] = [];
    for (let end = 252; end <= days.length; end++) {
        let strategy = 1;
        let buyHold = 1;
        for (let i = end - 252; i < end; i++) {
            strategy *= 1 + days[i].strategy;
            buyHold *= 1 + days[i].buyHold;
        }
        out.push({date: days[end - 1].date, value: strategy - buyHold});
    }
    return out;
}

function equityCurve(
    days: MomentumDay[],
    benchmarkReturns: (number | null)[]
): MomentumStudy["equity"] {
    let strategy = 100;
    let buyHold = 100;
    let equalWeight = 100;
    let benchmark = 100;
    let benchmarkKnown = false;
    return days.map((day, index) => {
        strategy *= 1 + day.strategy;
        buyHold *= 1 + day.buyHold;
        equalWeight *= 1 + day.equalWeight;
        const bench = benchmarkReturns[index];
        if (bench != null) {
            benchmark *= 1 + bench;
            benchmarkKnown = true;
        }
        return {
            date: day.date,
            strategy,
            buyHold,
            equalWeight,
            benchmark: benchmarkKnown ? benchmark : null,
        };
    });
}

async function benchmarkReturns(dates: string[]): Promise<{symbol: string; returns: (number | null)[]} | null> {
    const symbol = (await prisma.benchmarkPrice.count({where: {symbol: BENCHMARK}})) > 0 ? BENCHMARK : PRICE_BENCHMARK;
    const rows = await prisma.benchmarkPrice.findMany({
        where: {symbol, date: {gte: new Date(`${dates[0]}T00:00:00.000Z`)}},
        orderBy: {date: "asc"},
        select: {date: true, close: true},
    });
    if (rows.length < 2) return null;
    const closes = new Map(rows.map((row) => [toDateKey(row.date), Number(row.close)]));
    const ordered = [...closes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let cursor = 0;
    let prev: number | null = null;
    const returns = dates.map((date) => {
        while (cursor < ordered.length && ordered[cursor][0] < date) {
            prev = ordered[cursor][1];
            cursor++;
        }
        if (cursor < ordered.length && ordered[cursor][0] === date && prev != null && prev > 0) {
            const ret = ordered[cursor][1] / prev - 1;
            prev = ordered[cursor][1];
            cursor++;
            return ret;
        }
        return null;
    });
    return {symbol, returns};
}

async function factorAlpha(days: MomentumDay[]): Promise<MomentumStudy["alpha"]> {
    const from = new Date(`${days[0].date}T00:00:00.000Z`);
    const to = new Date(`${days[days.length - 1].date}T00:00:00.000Z`);
    const rows = await prisma.factorReturn.findMany({
        where: {date: {gte: from, lte: to}},
        orderBy: {date: "asc"},
    });
    const byDate = new Map<string, Map<string, number>>();
    for (const row of rows) {
        const key = toDateKey(row.date);
        const factors = byDate.get(key) ?? new Map<string, number>();
        factors.set(row.factor, Number(row.value));
        byDate.set(key, factors);
    }
    const y: number[] = [];
    const x: number[][] = [];
    for (const day of days) {
        const factors = byDate.get(day.date);
        if (!factors) continue;
        const rf = factors.get("RF");
        const regressors = FACTOR_NAMES.map((name) => factors.get(name));
        if (rf == null || regressors.some((value) => value == null)) continue;
        y.push(day.strategy - rf);
        x.push(regressors as number[]);
    }
    if (y.length <= FACTOR_NAMES.length + 1) return null;
    const fit = ols(y, x, 5);
    return {
        annualized: fit.beta[0] * 252,
        se: fit.se[0] * 252,
        tStat: fit.tStat[0],
        n: fit.n,
    };
}

export async function getMomentumStudy(input: {
    userId: string;
    portfolioId?: string;
    universe: "holdings" | "basket";
    commissionBps: number;
    slippageBps: number;
    allowShort: boolean;
}): Promise<MomentumStudy> {
    const notes = [
        "12-1 momentum, rebalanced monthly, long the top third. The rank uses the close twelve months before formation over the close one month before it. Nothing in the holding month is an input, and the rule has no fitted parameter.",
        `Costs are ${input.commissionBps} bps commission plus ${input.slippageBps} bps slippage on the sum of absolute weight changes. Entering from cash costs one unit; replacing the book costs two.`,
        `Sharpe uses a constant ${(env.RISK_FREE_RATE * 100).toFixed(1)}% risk-free rate. The factor alpha subtracts Ken French's daily RF and uses Newey–West standard errors.`,
        `Sharpe intervals are the 5th–95th percentile of ${BOOTSTRAP_RESAMPLES} stationary block bootstrap resamples (mean block ${BOOTSTRAP_BLOCK_LENGTH} sessions) of the out-of-sample daily returns. They keep volatility clustering that the ± SE ignores.`,
    ];

    let symbols: string[] = [];
    let basketAsOf: string | null = null;
    if (input.universe === "basket") {
        symbols = [...basketFile.symbols];
        basketAsOf = basketFile.asOf;
        notes.push(basketFile.note);
        notes.push("The list is applied back through 2015, so it contains companies that were not large then. Momentum and buy-and-hold share that list, which makes their comparison fair. The gap versus the S&P does not have that excuse.");
    } else {
        if (!input.portfolioId) throw new AppError(400, "VALIDATION_ERROR", "portfolioId is required for the holdings universe.");
        await getOwnedPortfolio(input.portfolioId, input.userId);
        const trades = await prisma.transaction.findMany({
            where: {portfolioId: input.portfolioId},
            select: {symbol: true},
            distinct: ["symbol"],
        });
        symbols = trades.map((trade) => trade.symbol).filter((symbol) => !symbol.includes(".")).sort();
        notes.push("Holdings universe: US names in this portfolio. Bursa names are excluded.");
    }

    const base: MomentumStudy = {
        universe: input.universe,
        basketAsOf,
        symbols,
        allowShort: input.allowShort,
        commissionBps: input.commissionBps,
        slippageBps: input.slippageBps,
        longCount: 0,
        shortCount: 0,
        latestLong: [],
        conclusion: "Not enough history to form a 12-1 book.",
        from: null,
        to: null,
        n: 0,
        strategy: null,
        buyHold: null,
        equalWeight: null,
        benchmark: null,
        benchmarkSymbol: null,
        alpha: null,
        equity: [],
        excess: [],
        turnover: [],
        notes,
    };
    if (symbols.length === 0) {
        notes.push("No US symbols in this universe.");
        return base;
    }

    const failed = await ensureHistory(symbols);
    if (failed.length > 0) notes.push(`No price history for ${failed.join(", ")}.`);
    const usable = symbols.filter((symbol) => !failed.includes(symbol));

    const [prices, dividendsBySymbol] = await Promise.all([
        prisma.dailyPrice.findMany({
            where: {symbol: {in: usable}},
            orderBy: {date: "asc"},
            select: {symbol: true, date: true, close: true},
        }),
        loadDividends(usable),
    ]);
    const closesBySymbol = new Map<string, {date: string; close: number}[]>();
    for (const price of prices) {
        const rows = closesBySymbol.get(price.symbol) ?? [];
        rows.push({date: toDateKey(price.date), close: Number(price.close)});
        closesBySymbol.set(price.symbol, rows);
    }
    const ready = usable.filter((symbol) => (closesBySymbol.get(symbol)?.length ?? 0) >= MIN_BARS);
    const dropped = usable.filter((symbol) => !ready.includes(symbol));
    if (dropped.length > 0) notes.push(`Dropped ${dropped.join(", ")}: fewer than ${MIN_BARS} sessions.`);
    if (ready.length === 0) return {...base, symbols: [], notes};

    const paired = ready
        .map((symbol) => ({
            symbol,
            level: buildLevel(closesBySymbol.get(symbol) ?? [], (dividendsBySymbol.get(symbol) ?? []).map((row) => ({
                date: toDateKey(row.exDate),
                amount: row.amount,
            }))),
        }))
        .filter((row) => row.level.length > 0);
    if (paired.length === 0) return {...base, symbols: [], notes};
    const panel = align(paired.map((row) => row.level));
    const names = paired.map((row) => row.symbol);
    const run = runMomentum(panel.dates, names, panel.levels, input.allowShort, input.commissionBps, input.slippageBps);
    if (run.days.length === 0) {
        notes.push("Need 14 months of overlapping prices before the first out-of-sample month.");
        return {...base, symbols: names, notes};
    }

    const bench = await benchmarkReturns(run.days.map((day) => day.date));
    const benchRets = bench?.returns ?? run.days.map(() => null);
    const benchOnly = benchRets.filter((ret): ret is number => ret != null);
    const alpha = await factorAlpha(run.days).catch((err) => {
        console.error("[momentum] factor alpha failed", err);
        return null;
    });
    if (!alpha) notes.push("Factor alpha needs the Ken French table. Run npm run factors:refresh.");
    else if (alpha.n < 120) notes.push(`Factor alpha is fit on ${alpha.n} sessions, under the 120 used on the Factors page.`);
    if (bench?.symbol === PRICE_BENCHMARK) notes.push("S&P comparison is the price index; sync ^SP500TR for the total-return version.");
    if (input.allowShort) notes.push("The short book is the bottom third, sized so the longs and shorts each carry half the gross.");

    const strategy = stats(
        run.days.map((day) => day.strategy),
        run.months.map((month) => month.strategy),
        run.months.map((month) => month.turnover)
    );
    const buyHoldMonthly = monthlyReturns(run.days, (day) => day.buyHold);
    const equalMonthly = monthlyReturns(run.days, (day) => day.equalWeight);

    return {
        ...base,
        symbols: names,
        longCount: run.longCount,
        shortCount: run.shortCount,
        latestLong: run.latestLong,
        conclusion: momentumConclusion(strategy.annualizedReturn, annualizedReturn(run.days.map((day) => day.buyHold)), run.days.length, names.length),
        from: run.days[0].date,
        to: run.days[run.days.length - 1].date,
        n: run.days.length,
        strategy,
        buyHold: stats(run.days.map((day) => day.buyHold), buyHoldMonthly, null),
        equalWeight: stats(run.days.map((day) => day.equalWeight), equalMonthly, null),
        benchmark: bench && benchOnly.length > 20
            ? stats(
                benchRets.map((ret) => ret ?? 0),
                monthlyReturns(
                    run.days.map((day, index) => ({...day, buyHold: benchRets[index] ?? 0})),
                    (day) => day.buyHold
                ),
                null
            )
            : null,
        benchmarkSymbol: bench?.symbol ?? null,
        alpha,
        equity: equityCurve(run.days, benchRets),
        excess: rollingExcess(run.days),
        turnover: run.months.map((month) => ({month: month.month, turnover: month.turnover})),
        notes,
    };
}
