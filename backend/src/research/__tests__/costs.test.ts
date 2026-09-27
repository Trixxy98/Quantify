import {describe, expect, it} from "vitest";
import {applyCosts, costDrag} from "../costs";

describe("costs", () => {
    it("charges commission and slippage on the fraction traded", () => {
        expect(costDrag(1, 5, 5)).toBeCloseTo(0.001, 10);
        expect(costDrag(0.5, 5, 5)).toBeCloseTo(0.0005, 10);
    });

    it("subtracts the drag from each gross return", () => {
        expect(applyCosts([0.01, 0.02], [1, 0.5], 5, 5)).toEqual([
            expect.closeTo(0.009, 10),
            expect.closeTo(0.0195, 10),
        ]);
    });
});
