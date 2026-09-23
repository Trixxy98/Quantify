import {Exchange} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {covariance, stdDev, variance} from "../utils/stats.util";
import {type Range, resolveRangeStart, toDateKey} from "../utils/dateRange";
import {latestAtOrBefore, type SeriesPoint} from "./fx";
import {
    annualizedReturn,
    compositeBenchmarkReturns,
    maxDrawdown,
    toDailyReturns,
    volatility,
} from "./metrics.service";
import {loadRiskPath} from "./dashboard.service";
import {markOpenPositions} from "./valuation.service";
import {
    annualizedVolFromDailyVariances,
    correlationMatrix,
    drawdownEpisodes,
    expectedShortfall,
    garmanKlassDaily,
    kupiecStatistic,
    portfolioRisk,
    quantile,
    rollingVolBeta,
    sampleCovarianceMatrix,
    ulcerIndex,
} from "./risk.math";

const BURSA_BENCHMARK = "^KLSE";
const ANN = Math.sqrt(252);
const MIN_OVERLAP = 20;
const ROLLING = 60;
const VAR_P = 0.05;
const VAR_99 = 0.01;

type Bar = {date: string; time: number; open: number; high: number; low: number; close: number};

function betaTo(stock: number[], bench: number[]): number | null {
    if (stock.length < MIN_OVERLAP) return null;
    const benchVar = variance(bench);
    if (!Number.isFinite(benchVar) || benchVar < 1e-18) return null;
    return covariance(stock, bench) / benchVar;
}

export async function getRisk(portfolioId: string, userId: string, range: Range) {
    const path = await loadRiskPath(portfolioId, userId, range);
    const marks = await markOpenPositions(portfolioId, path.baseCurrency);
    const priced = marks.filter((mark) => mark.marketValue != null && mark.marketValue > 0);
    const totalValue = priced.reduce((sum, mark) => sum + mark.marketValue!, 0);

    const twrReturns = toDailyReturns(path.twr);
    const maxDd = path.twr.length > 1 ? maxDrawdown(path.twr) : 0;
    const annual = twrReturns.length > 0 ? annualizedReturn(twrReturns) : 0;

    let peak = path.twr[0]?.value ?? 0;
    const underwater = path.twr.map((point) => {
        if (point.value > peak) peak = point.value;
        return {date: point.date, drawdown: peak > 0 ? (point.value - peak) / peak : 0};
    });

    const benchReturns = compositeBenchmarkReturns(
        toDailyReturns(path.aligned.kSeries),
        toDailyReturns(path.aligned.gSeries),
        path.weights.bursa,
        path.weights.us
    );
    const benchDates = path.aligned.pSeries.slice(1).map((point) => point.date);
    const alignedPortReturns = toDailyReturns(path.aligned.pSeries);

    const notes: string[] = [
        "Volatility, VaR and drawdowns use the time-weighted, dividend-inclusive portfolio path. Deposits are not gains.",
        "Risk share uses today's weights times the covariance of sessions where every held name traded. Shares sum to 100% of that volatility.",
        "Garman–Klass uses the high, low, open and close. Close-to-close is shown beside it because the risk shares are still close-to-close.",
    ];
    if (twrReturns.length < 60) {
        notes.push(`Only ${twrReturns.length} daily portfolio returns in this range. Treat VaR and Sharpe-style ratios as estimates.`);
    }

    const names = await nameRisk(priced, totalValue, range, notes);

    const kupiecWindow = Math.min(ROLLING, Math.max(twrReturns.length - 1, 0));
    let breaches = 0;
    let trials = 0;
    if (twrReturns.length > ROLLING) {
        for (let i = ROLLING; i < twrReturns.length; i++) {
            const threshold = quantile(twrReturns.slice(i - ROLLING, i), VAR_P);
            trials += 1;
            if (twrReturns[i] <= threshold) breaches += 1;
        }
    }

    return {
        range,
        asOf: path.twr.at(-1)?.date ?? null,
        baseCurrency: path.baseCurrency,
        observations: twrReturns.length,
        isLowConfidence: twrReturns.length < 60,
        usBenchmark: path.usBenchmark,
        notes,
        path: {
            volatility: twrReturns.length > 1 ? volatility(twrReturns) : 0,
            maxDrawdown: maxDd,
            calmar: maxDd < 0 ? annual / Math.abs(maxDd) : null,
            ulcer: ulcerIndex(path.twr.map((point) => point.value)),
            var95: twrReturns.length >= MIN_OVERLAP ? quantile(twrReturns, VAR_P) : null,
            var99: twrReturns.length >= MIN_OVERLAP ? quantile(twrReturns, VAR_99) : null,
            es95: twrReturns.length >= MIN_OVERLAP ? expectedShortfall(twrReturns, VAR_P) : null,
            es99: twrReturns.length >= MIN_OVERLAP ? expectedShortfall(twrReturns, VAR_99) : null,
            kupiec:
                trials >= MIN_OVERLAP
                    ? {
                          p: VAR_P,
                          window: kupiecWindow,
                          trials,
                          breaches,
                          expected: trials * VAR_P,
                          ...kupiecStatistic(breaches, trials, VAR_P)!,
                      }
                    : null,
        },
        names: names.rows,
        correlation: names.correlation,
        underwater,
        rolling: rollingVolBeta(alignedPortReturns, benchReturns, benchDates, ROLLING),
        drawdowns: drawdownEpisodes(path.twr),
    };
}

async function nameRisk(
    priced: {symbol: string; exchange: Exchange; marketValue: number | null}[],
    totalValue: number,
    range: Range,
    notes: string[]
) {
    if (priced.length === 0 || totalValue <= 0) {
        return {rows: [], correlation: {symbols: [] as string[], matrix: [] as number[][]}};
    }

    const symbols = priced.map((mark) => mark.symbol);
    const start = resolveRangeStart(range);
    const prices = await prisma.dailyPrice.findMany({
        where: {symbol: {in: symbols}},
        orderBy: {date: "asc"},
    });
    const benchmarks = await prisma.benchmarkPrice.findMany({
        where: {symbol: {in: [BURSA_BENCHMARK, "^GSPC", "^SP500TR"]}},
        orderBy: {date: "asc"},
    });

    const bySymbol = new Map<string, Bar[]>();
    for (const row of prices) {
        const bar: Bar = {
            date: toDateKey(row.date),
            time: row.date.getTime(),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
        };
        const list = bySymbol.get(row.symbol) ?? [];
        list.push(bar);
        bySymbol.set(row.symbol, list);
    }

    const klci: SeriesPoint[] = [];
    const spx: SeriesPoint[] = [];
    for (const row of benchmarks) {
        const point = {date: row.date.getTime(), close: Number(row.close)};
        if (row.symbol === BURSA_BENCHMARK) klci.push(point);
        else if (row.symbol === "^GSPC") spx.push(point);
    }

    const usable = symbols.filter((symbol) => (bySymbol.get(symbol)?.length ?? 0) > 1);
    const dateSets = usable.map((symbol) => new Set((bySymbol.get(symbol) ?? []).map((bar) => bar.date)));
    const overlap = [...dateSets[0] ?? []]
        .filter((date) => dateSets.every((set) => set.has(date)))
        .sort();

    const inRange = (date: string) => !start || date >= toDateKey(start);
    const returnDates = overlap.filter((date, index) => index > 0 && inRange(date));

    const columns = usable.map((symbol) => {
        const bars = new Map((bySymbol.get(symbol) ?? []).map((bar) => [bar.date, bar.close]));
        return returnDates.map((date) => {
            const prev = bars.get(overlap[overlap.indexOf(date) - 1])!;
            const curr = bars.get(date)!;
            return prev > 0 ? (curr - prev) / prev : 0;
        });
    });

    const weights = usable.map((symbol) => {
        const mark = priced.find((row) => row.symbol === symbol)!;
        return mark.marketValue! / totalValue;
    });
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const scaledWeights = weights.map((weight) => weight / weightSum);

    const enough = columns[0]?.length >= MIN_OVERLAP;
    const cov = enough ? sampleCovarianceMatrix(columns) : [];
    const parts = enough ? portfolioRisk(scaledWeights, cov) : null;
    const corr = enough ? correlationMatrix(cov) : [];
    if (!enough) {
        notes.push("Not enough sessions where every holding traded together, so correlation and risk shares are withheld.");
    }

    const rows = usable.map((symbol, index) => {
        const bars = bySymbol.get(symbol) ?? [];
        const gk = bars
            .filter((bar) => inRange(bar.date))
            .map((bar) => garmanKlassDaily(bar.open, bar.high, bar.low, bar.close))
            .filter((value): value is number => value != null);
        const ownReturns: number[] = [];
        const benchReturns: number[] = [];
        const bench = priced.find((row) => row.symbol === symbol)?.exchange === Exchange.BURSA ? klci : spx;
        for (let i = 1; i < bars.length; i++) {
            if (!inRange(bars[i].date) || !(bars[i - 1].close > 0)) continue;
            const b0 = latestAtOrBefore(bench, bars[i - 1].time);
            const b1 = latestAtOrBefore(bench, bars[i].time);
            if (b0 == null || b1 == null || !(b0 > 0)) continue;
            ownReturns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
            benchReturns.push((b1 - b0) / b0);
        }
        return {
            symbol,
            weight: scaledWeights[index],
            closeToCloseVol: columns[index]?.length > 1 ? stdDev(columns[index]) * ANN : 0,
            gkVol: annualizedVolFromDailyVariances(gk),
            beta: betaTo(ownReturns, benchReturns),
            mctr: parts ? parts.mctr[index] * ANN : null,
            cctr: parts ? parts.cctr[index] * ANN : null,
            riskShare: parts ? parts.share[index] : null,
        };
    });

    return {
        rows: rows.sort((a, b) => (b.riskShare ?? -1) - (a.riskShare ?? -1)),
        correlation: {
            symbols: usable,
            matrix: corr,
        },
    };
}