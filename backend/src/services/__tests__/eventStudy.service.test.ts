import {describe, expect, it} from "vitest";
import {finalCarInterval} from "../eventStudy.service";

describe("finalCarInterval", () => {
    it("clusters names that share an event date", () => {
        const events = Array.from({length: 10}, (_, i) => {
            const date = `2026-0${(i % 9) + 1}-15`;
            return [
                {date, car: 0.01 * (i - 5)},
                {date, car: 0.01 * (i - 5) + 0.001},
            ];
        }).flat();
        const result = finalCarInterval(events, 5);
        expect(result.offset).toBe(5);
        expect(result.dates).toBe(9);
        expect(result.acar).toBeCloseTo(events.reduce((sum, e) => sum + e.car, 0) / events.length, 12);
        expect(result.interval).not.toBeNull();
        expect(result.interval!.method).toBe("cluster");
        expect(result.interval!.low).toBeLessThan(result.acar);
        expect(result.interval!.high).toBeGreaterThan(result.acar);
    });

    it("has no interval with too few distinct dates", () => {
        const events = Array.from({length: 20}, (_, i) => ({date: i % 2 ? "2026-01-28" : "2026-03-18", car: i / 100}));
        const result = finalCarInterval(events, 3);
        expect(result.dates).toBe(2);
        expect(result.interval).toBeNull();
    });
});
