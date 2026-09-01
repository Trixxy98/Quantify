import {describe, expect, it} from "vitest";
import {adjustTrade, isRebased, splitFactorAfter, type SplitRow} from "../corporateActions";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getTime();

const appleSplit: SplitRow[] = [
    {date: new Date("2020-08-31T00:00:00.000Z"), numerator: 4, denominator: 1},
];

const nvidiaSplits: SplitRow[] = [
    {date: new Date("2021-07-20T00:00:00.000Z"), numerator: 4, denominator: 1},
    {date: new Date("2024-06-10T00:00:00.000Z"), numerator: 10, denominator: 1},
];

describe("splitFactorAfter", () => {
    it("is 1 when no split has happened yet", () => {
        expect(splitFactorAfter(appleSplit, utc("2021-01-04"))).toBe(1);
    });

    it("applies a split that came after the trade", () => {
        expect(splitFactorAfter(appleSplit, utc("2019-05-01"))).toBe(4);
    });

    it("compounds several later splits", () => {
        expect(splitFactorAfter(nvidiaSplits, utc("2020-01-02"))).toBe(40);
    });

    it("only counts the splits still ahead of the trade", () => {
        expect(splitFactorAfter(nvidiaSplits, utc("2022-01-03"))).toBe(10);
    });

    it("treats a trade on the split date as already restated", () => {
        expect(splitFactorAfter(appleSplit, utc("2020-08-31"))).toBe(1);
    });

    it("ignores malformed rows instead of producing Infinity", () => {
        const broken: SplitRow[] = [
            {date: new Date("2020-01-01T00:00:00.000Z"), numerator: 2, denominator: 0},
        ];
        expect(splitFactorAfter(broken, utc("2019-01-01"))).toBe(1);
    });

    it("is 1 for a symbol that never split", () => {
        expect(splitFactorAfter([], utc("2019-01-01"))).toBe(1);
    });
});

describe("isRebased", () => {
    it("catches a 4:1 split restating the history", () => {
        // Stored 500 before the split, Yahoo now reports 125 for the same day
        expect(isRebased(500, 125)).toBe(true);
    });

    it("catches even a 2:1 split", () => {
        expect(isRebased(100, 50)).toBe(true);
    });

    it("tolerates ordinary vendor rounding", () => {
        expect(isRebased(124.82, 124.83)).toBe(false);
    });

    it("stays quiet when the close is identical", () => {
        expect(isRebased(124.82, 124.82)).toBe(false);
    });

    it("does not fire on missing or zero data", () => {
        expect(isRebased(0, 125)).toBe(false);
        expect(isRebased(500, 0)).toBe(false);
        expect(isRebased(Number.NaN, 125)).toBe(false);
    });

    it("fires just outside the tolerance band and not just inside", () => {
        expect(isRebased(100, 100.4)).toBe(false);
        expect(isRebased(100, 100.6)).toBe(true);
    });
});

describe("adjustTrade", () => {
    it("multiplies shares and divides price", () => {
        const result = adjustTrade(100, 500, appleSplit, utc("2019-05-01"));
        expect(result.quantity).toBe(400);
        expect(result.price).toBe(125);
    });

    it("leaves the cash outlay unchanged", () => {
        const raw = {quantity: 37, price: 413.5};
        const adjusted = adjustTrade(raw.quantity, raw.price, nvidiaSplits, utc("2020-03-02"));
        expect(adjusted.quantity * adjusted.price).toBeCloseTo(raw.quantity * raw.price, 9);
    });

    it("passes the trade through untouched when nothing split", () => {
        expect(adjustTrade(10, 25, [], utc("2024-01-02"))).toEqual({quantity: 10, price: 25});
    });
});
