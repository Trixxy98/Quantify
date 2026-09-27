import {describe, expect, it} from "vitest";
import {walkForward, walkForwardFolds} from "../walkForward";

describe("walkForward", () => {
    it("drops the last fold when the test window would run past the sample", () => {
        const folds = walkForwardFolds(9, 4, 2, 2);
        expect(folds).toEqual([
            {trainStart: 0, trainEnd: 4, testStart: 4, testEnd: 6},
            {trainStart: 2, trainEnd: 6, testStart: 6, testEnd: 8},
        ]);
    });

    it("never shows the test window to the fit, and does not overlap tests", () => {
        const seen: number[] = [];
        const result = walkForward(
            10,
            4,
            2,
            2,
            (start, end) => {
                const train: number[] = [];
                for (let i = start; i < end; i++) train.push(i);
                return train;
            },
            (train, start, end) => {
                for (let i = start; i < end; i++) {
                    expect(train).not.toContain(i);
                    expect(i).toBeGreaterThanOrEqual(train[train.length - 1] + 1);
                    seen.push(i);
                }
                return Array.from({length: end - start}, () => 1);
            }
        );

        expect(result.folds).toHaveLength(3);
        expect(result.returns).toEqual([1, 1, 1, 1, 1, 1]);
        expect(seen).toEqual([4, 5, 6, 7, 8, 9]);
        for (let i = 1; i < result.folds.length; i++) {
            expect(result.folds[i].testStart).toBeGreaterThanOrEqual(result.folds[i - 1].testEnd);
        }
    });
});
