import {describe, expect, it} from "vitest";
import {
    alpha,
    annualizedReturn,
    beta,
    cagr,
    indexTo100,
    maxDrawdown,
    sharpeRatio,
    sharpeStandardError,
    timeWeightedIndex,
    toDailyReturns,
    todayReturn,
    volatility,
    type DailyValue,
} from "../metrics.service";

/** Trading-day series helper: values become 2024-01-01, 01-02, ... */
function series(values: number[]): DailyValue[] {
    return values.map((value, i) => ({
        date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
        value,
    }));
}

describe("toDailyReturns", () => {
    it("computes simple returns between consecutive points", () => {
        expect(toDailyReturns(series([100, 110, 99]))).toEqual([0.1, -0.1]);
    });

    it("returns nothing for a single point", () => {
        expect(toDailyReturns(series([100]))).toEqual([]);
    });
});

describe("todayReturn", () => {
    it("uses the last two points", () => {
        expect(todayReturn(series([100, 110, 121]))).toBeCloseTo(0.1, 12);
    });

    it("is zero when there is nothing to compare", () => {
        expect(todayReturn(series([100]))).toBe(0);
    });
});

describe("annualizedReturn", () => {
    it("annualises a compounded run of daily returns", () => {
        // 252 days at +0.1% compounds to 1.001^252 - 1
        const daily = Array(252).fill(0.001);
        expect(annualizedReturn(daily)).toBeCloseTo(Math.pow(1.001, 252) - 1, 10);
    });

    it("scales a half-year sample up to a year", () => {
        const daily = Array(126).fill(0.001);
        expect(annualizedReturn(daily)).toBeCloseTo(Math.pow(1.001, 252) - 1, 10);
    });

    it("does not blow up on an empty sample", () => {
        expect(annualizedReturn([])).toBe(0);
    });

    it("floors at total loss instead of returning NaN", () => {
        expect(annualizedReturn([-1, 0.5])).toBe(-1);
    });
});

describe("cagr", () => {
    it("doubles over one year", () => {
        expect(cagr(100, 200, 1)).toBeCloseTo(1, 12);
    });

    it("takes the square root over two years", () => {
        expect(cagr(100, 200, 2)).toBeCloseTo(Math.SQRT2 - 1, 12);
    });

    it("guards against a zero-length window", () => {
        expect(cagr(100, 200, 0)).toBe(0);
    });
});

describe("volatility", () => {
    it("annualises the sample standard deviation by root 252", () => {
        // Sample sd of [0.01, -0.01] is 0.01 * sqrt(2)
        const expected = 0.01 * Math.SQRT2 * Math.sqrt(252);
        expect(volatility([0.01, -0.01])).toBeCloseTo(expected, 12);
    });

    it("is zero for a flat series", () => {
        expect(volatility([0.005, 0.005, 0.005])).toBeCloseTo(0, 12);
    });
});

describe("sharpeRatio", () => {
    it("matches a hand-computed value", () => {
        const daily = [0.01, -0.005, 0.008, 0.002];
        const rf = 0.0252; // 0.0001/day
        const excess = daily.map((r) => r - 0.0001);
        const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
        const varc =
            excess.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (excess.length - 1);
        const expected = (mean / Math.sqrt(varc)) * Math.sqrt(252);

        expect(sharpeRatio(daily, rf)).toBeCloseTo(expected, 12);
    });

    it("is zero when returns never move", () => {
        expect(sharpeRatio([0.001, 0.001, 0.001], 0.03)).toBe(0);
    });
});

describe("sharpeStandardError", () => {
    it("shrinks as the sample grows", () => {
        const short = Array(30).fill(0.001);
        const long = Array(3000).fill(0.001);
        // Constant returns give zero sd, so add a wobble to keep it defined
        short[0] = 0.002;
        long[0] = 0.002;
        expect(sharpeStandardError(short, 0.03)).toBeGreaterThan(
            sharpeStandardError(long, 0.03)
        );
    });

    it("is zero without enough points", () => {
        expect(sharpeStandardError([0.01], 0.03)).toBe(0);
    });
});

describe("beta and alpha", () => {
    it("recovers the slope of a perfectly geared portfolio", () => {
        const bench = [0.01, -0.02, 0.015, 0.004, -0.008];
        const port = bench.map((r) => 1.5 * r);
        expect(beta(port, bench)).toBeCloseTo(1.5, 12);
    });

    it("is zero when the benchmark never moves", () => {
        expect(beta([0.01, 0.02], [0.005, 0.005])).toBe(0);
    });

    it("prices CAPM expectation out of the return", () => {
        // 12% return, 8% benchmark, 3% risk free, beta 1.5
        // expected = 3% + 1.5 * 5% = 10.5%, so alpha = 1.5%
        expect(alpha(0.12, 0.08, 0.03, 1.5)).toBeCloseTo(0.015, 12);
    });
});

describe("maxDrawdown", () => {
    it("measures peak to trough, not first to last", () => {
        expect(maxDrawdown(series([100, 120, 60, 90]))).toBeCloseTo(-0.5, 12);
    });

    it("is zero for a series that only rises", () => {
        expect(maxDrawdown(series([100, 101, 102]))).toBe(0);
    });
});

describe("indexTo100", () => {
    it("rebases the series to its own start", () => {
        expect(indexTo100(series([50, 75]))).toEqual([
            {date: "2024-01-01", indexedValue: 100},
            {date: "2024-01-02", indexedValue: 150},
        ]);
    });
});

describe("timeWeightedIndex", () => {
    const noFlows = new Map<string, number>();

    it("tracks pure market movement when nothing is added", () => {
        const twr = timeWeightedIndex(series([100, 110]), noFlows);
        expect(twr.at(-1)!.value).toBeCloseTo(110, 12);
    });

    it("ignores a deposit that did not earn anything", () => {
        // NAV goes 100 -> 200 purely because 100 was paid in
        const flows = new Map([["2024-01-02", 100]]);
        const twr = timeWeightedIndex(series([100, 200]), flows);
        expect(twr.at(-1)!.value).toBeCloseTo(100, 12);
    });

    it("ignores a withdrawal that did not lose anything", () => {
        const flows = new Map([["2024-01-02", -50]]);
        const twr = timeWeightedIndex(series([100, 50]), flows);
        expect(twr.at(-1)!.value).toBeCloseTo(100, 12);
    });

    it("gives the same answer whether or not money was added mid-way", () => {
        // Both portfolios earn +10% then +10%. The second one doubles in size
        // after day 1, which must not change the reported return.
        const undisturbed = timeWeightedIndex(series([100, 110, 121]), noFlows);
        const funded = timeWeightedIndex(
            series([100, 210, 231]),
            new Map([["2024-01-02", 100]])
        );
        expect(funded.at(-1)!.value).toBeCloseTo(undisturbed.at(-1)!.value, 10);
    });

    it("adds dividends back so an ex-date is not read as a loss", () => {
        // Price drops by exactly the 2.00 dividend: a flat day, not -2%
        const income = new Map([["2024-01-02", 2]]);
        const twr = timeWeightedIndex(series([100, 98]), noFlows, income);
        expect(twr.at(-1)!.value).toBeCloseTo(100, 12);
    });

    it("without dividends the same day looks like a loss", () => {
        const twr = timeWeightedIndex(series([100, 98]), noFlows);
        expect(twr.at(-1)!.value).toBeCloseTo(98, 12);
    });

    it("starts at 100 and returns empty for no data", () => {
        expect(timeWeightedIndex([], noFlows)).toEqual([]);
        expect(timeWeightedIndex(series([100]), noFlows)[0].value).toBe(100);
    });
});
