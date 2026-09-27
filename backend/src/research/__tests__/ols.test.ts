import {describe, expect, it} from "vitest";
import {ols} from "../ols";

// Hand solution for y = [1, 2, 2], x = [1, 2, 3]:
//   β = [2/3, 1/2]
//   HC0 (lag 0): se = [sqrt(2/27), sqrt(1/72)]
//   Newey–West lag 1: se = [sqrt(5/81), sqrt(1/72)]
const y = [1, 2, 2];
const x = [[1], [2], [3]];

describe("ols", () => {
    it("matches a hand-computed three-point regression", () => {
        const fit = ols(y, x, 0);
        expect(fit.beta[0]).toBeCloseTo(2 / 3, 10);
        expect(fit.beta[1]).toBeCloseTo(0.5, 10);
        expect(fit.n).toBe(3);
        expect(fit.rSquared).toBeCloseTo(0.75, 8);
    });

    it("matches the hand-computed White and Newey–West standard errors", () => {
        const white = ols(y, x, 0);
        expect(white.se[0]).toBeCloseTo(Math.sqrt(2 / 27), 8);
        expect(white.se[1]).toBeCloseTo(Math.sqrt(1 / 72), 8);
        expect(white.tStat[1]).toBeCloseTo(0.5 / Math.sqrt(1 / 72), 8);

        const nw = ols(y, x, 1);
        expect(nw.se[0]).toBeCloseTo(Math.sqrt(5 / 81), 8);
        expect(nw.se[1]).toBeCloseTo(Math.sqrt(1 / 72), 8);
    });

    it("recovers a perfect line with no residual variance", () => {
        const fit = ols([1, 2, 3, 4], [[1], [2], [3], [4]], 0);
        expect(fit.beta[0]).toBeCloseTo(0, 8);
        expect(fit.beta[1]).toBeCloseTo(1, 8);
        expect(fit.se[1]).toBeCloseTo(0, 8);
        expect(fit.rSquared).toBeCloseTo(1, 8);
    });
});
