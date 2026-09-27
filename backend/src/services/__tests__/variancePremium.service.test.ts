import {describe, expect, it} from "vitest";
import {
    EXPECTED_ABS_FACTOR,
    eventSessionMove,
    eventVariance,
    expiryBefore,
    expiryCovering,
    impliedFromStraddle,
    median,
    percentileRank,
} from "../variancePremium.service";

describe("eventVariance", () => {
    it("is the variance left between the bracketing expiries", () => {
        // 20% vol for 30 days, 25% vol for 37 days: the extra week carries the event.
        const before = 0.2 * 0.2 * (30 / 365);
        const after = 0.25 * 0.25 * (37 / 365);
        expect(eventVariance(0.2, 30 / 365, 0.25, 37 / 365)).toBeCloseTo(after - before, 12);
    });

    it("is null when the near expiry carries more variance", () => {
        expect(eventVariance(0.5, 30 / 365, 0.2, 37 / 365)).toBeNull();
        expect(eventVariance(0.2, 37 / 365, 0.25, 30 / 365)).toBeNull();
    });
});

describe("impliedFromStraddle", () => {
    it("prefers the quoted IV", () => {
        expect(impliedFromStraddle({impliedMove: 0.05, atmIv: 0.22}, 0.1)).toBe(0.22);
    });

    it("inverts the straddle price when IV is missing", () => {
        const years = 0.1;
        const sigma = 0.3;
        const move = EXPECTED_ABS_FACTOR * sigma * Math.sqrt(years);
        expect(impliedFromStraddle({impliedMove: move, atmIv: null}, years)).toBeCloseTo(sigma, 10);
    });
});

describe("expiryBefore", () => {
    it("takes the last expiry strictly before the event", () => {
        expect(expiryBefore(["2026-01-16", "2026-02-20", "2026-03-20"], "2026-02-20")).toBe("2026-01-16");
    });

    it("is null when the event is inside the front expiry", () => {
        expect(expiryBefore(["2026-02-20", "2026-03-20"], "2026-02-18")).toBeNull();
    });
});

describe("expiryCovering", () => {
    it("picks the first expiry on or after the event", () => {
        expect(expiryCovering(["2026-01-16", "2026-02-20", "2026-03-20"], "2026-02-18")).toBe("2026-02-20");
    });

    it("is empty when the event is past the chain", () => {
        expect(expiryCovering(["2026-01-16"], "2026-06-01")).toBeNull();
    });
});

describe("eventSessionMove", () => {
    const keys = ["2024-01-02", "2024-01-03", "2024-01-04"];
    const closes = [100, 110, 105];

    it("uses the first session on or after the event", () => {
        expect(eventSessionMove(keys, closes, "2024-01-03")).toEqual({date: "2024-01-03", move: 0.1});
    });

    it("steps forward to the next session when the event is a holiday", () => {
        const holidayKeys = ["2024-01-02", "2024-01-03", "2024-01-05"];
        const holidayCloses = [100, 110, 105];
        const holiday = eventSessionMove(holidayKeys, holidayCloses, "2024-01-04");
        expect(holiday?.date).toBe("2024-01-05");
        expect(holiday?.move).toBeCloseTo((105 - 110) / 110, 8);
    });

    it("spans two sessions for after-close reporters", () => {
        const twoDay = eventSessionMove(keys, closes, "2024-01-03", 2);
        expect(twoDay?.date).toBe("2024-01-03");
        expect(twoDay?.move).toBeCloseTo(0.05, 8);
        expect(eventSessionMove(keys, closes, "2024-01-04", 2)).toBeNull();
    });

    it("needs a previous close", () => {
        expect(eventSessionMove(keys, closes, "2024-01-01")).toBeNull();
        expect(eventSessionMove(keys, closes, "2024-01-05")).toBeNull();
    });
});

describe("distribution helpers", () => {
    it("averages the two middle values for an even sample", () => {
        expect(median([0.04, 0.01, 0.03, 0.02])).toBeCloseTo(0.025, 8);
    });

    it("ranks today's price inside past absolute moves", () => {
        expect(percentileRank([0.01, 0.02, 0.04, 0.08], 0.03)).toBeCloseTo(0.5, 8);
    });
});
