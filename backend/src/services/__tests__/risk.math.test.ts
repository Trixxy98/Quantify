import {describe, expect, it} from "vitest";
import {
    annualizedVolFromDailyVariances,
    correlationMatrix,
    drawdownEpisodes,
    expectedShortfall,
    garmanKlassDaily,
    kupiecStatistic,
    portfolioRisk,
    quantile,
    sampleCovarianceMatrix,
} from "../risk.math";

describe("garmanKlassDaily", () => {
    it("is zero on a bar that did not trade", () => {
        expect(garmanKlassDaily(10, 10, 10, 10)).toBe(0);
    });

    it("rejects a broken high-low", () => {
        expect(garmanKlassDaily(10, 9, 11, 10)).toBeNull();
    });

    it("annualises a constant daily variance by 252", () => {
        expect(annualizedVolFromDailyVariances([0.0004, 0.0004])).toBeCloseTo(Math.sqrt(0.0004 * 252), 12);
    });
});

describe("quantile and shortfall", () => {
    it("picks the nearest rank in the left tail", () => {
        const sample = [0.05, 0.01, -0.02, -0.04, 0.03];
        expect(quantile(sample, 0.2)).toBe(-0.04);
    });

    it("averages every return at or below the cutoff", () => {
        expect(expectedShortfall([-0.04, -0.02, 0.01], 0.4)).toBeCloseTo(-0.03, 12);
    });
});

describe("kupiecStatistic", () => {
    it("does not reject a breach rate near the model", () => {
        const result = kupiecStatistic(5, 100, 0.05);
        expect(result?.rejectAt5Pct).toBe(false);
    });

    it("rejects a model that never breaks", () => {
        const result = kupiecStatistic(0, 250, 0.05);
        expect(result?.rejectAt5Pct).toBe(true);
    });
});

describe("portfolioRisk", () => {
    it("splits volatility in half for two identical names", () => {
        const cov = sampleCovarianceMatrix([
            [0.01, -0.01, 0.02],
            [0.01, -0.01, 0.02],
        ]);
        const risk = portfolioRisk([0.5, 0.5], cov);
        expect(risk.share[0] + risk.share[1]).toBeCloseTo(1, 8);
        expect(risk.cctr[0] + risk.cctr[1]).toBeCloseTo(risk.sigma, 8);
        expect(correlationMatrix(cov)[0][1]).toBeCloseTo(1, 8);
    });

    it("matches a hand-computed two-asset book", () => {
        const cov = [
            [0.04, 0.01],
            [0.01, 0.04],
        ];
        const risk = portfolioRisk([0.5, 0.5], cov);
        expect(risk.sigma).toBeCloseTo(Math.sqrt(0.025), 10);
        expect(risk.share[0]).toBeCloseTo(0.5, 10);
    });
});

describe("drawdownEpisodes", () => {
    it("keeps the deeper episode and leaves an open one unrecovered", () => {
        const episodes = drawdownEpisodes([
            {date: "2024-01-01", value: 100},
            {date: "2024-01-02", value: 120},
            {date: "2024-01-03", value: 60},
            {date: "2024-01-04", value: 130},
            {date: "2024-01-05", value: 100},
        ]);
        expect(episodes[0].depth).toBeCloseTo(-0.5, 8);
        expect(episodes[0].recovered).toBe("2024-01-04");
        expect(episodes[1].recovered).toBeNull();
    });
});