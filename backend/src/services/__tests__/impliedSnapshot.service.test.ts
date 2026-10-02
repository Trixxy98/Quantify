import {describe, expect, it} from "vitest";
import {atmStraddle, frontMonthExpiry, ivRank, missedSessions} from "../impliedSnapshot.service";

describe("missedSessions", () => {
    it("lists exchange sessions after the first recording that have no row", () => {
        const calendar = ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"];
        expect(missedSessions(calendar, ["2026-09-25", "2026-09-29"], "2026-09-25")).toEqual(["2026-09-28", "2026-09-30"]);
    });
});

describe("atmStraddle", () => {
    const calls = [
        {strike: 95, bid: 6, ask: 6.4, impliedVolatility: 0.22},
        {strike: 100, bid: 2.9, ask: 3.1, impliedVolatility: 0.2},
        {strike: 105, bid: 0.9, ask: 1.1, impliedVolatility: 0.19},
    ];
    const puts = [
        {strike: 95, bid: 0.8, ask: 1, impliedVolatility: 0.24},
        {strike: 100, bid: 2.4, ask: 2.6, impliedVolatility: 0.22},
        {strike: 105, bid: 5.8, ask: 6.2, impliedVolatility: 0.21},
    ];

    it("takes the strike nearest spot and averages both IVs", () => {
        const result = atmStraddle(calls, puts, 100.4);
        expect(result?.strike).toBe(100);
        expect(result?.impliedMove).toBeCloseTo((3 + 2.5) / 100.4, 8);
        expect(result?.atmIv).toBeCloseTo(0.21, 8);
    });

    it("falls back to the next strike when the nearest has no quote", () => {
        const noPut = puts.map((put) => (put.strike === 100 ? {strike: 100} : put));
        const result = atmStraddle(calls, noPut, 100.4);
        expect(result?.strike).toBe(105);
    });

    it("is null without spot or matching strikes", () => {
        expect(atmStraddle(calls, puts, 0)).toBeNull();
        expect(atmStraddle(calls, [], 100)).toBeNull();
    });
});

describe("frontMonthExpiry", () => {
    const now = new Date("2026-09-27T00:00:00.000Z");
    const expiries = ["2026-10-02", "2026-10-09", "2026-10-16", "2026-11-20"].map((key) => new Date(`${key}T00:00:00.000Z`));

    it("skips expiries inside the minimum tenor", () => {
        expect(frontMonthExpiry(expiries, now)?.toISOString().slice(0, 10)).toBe("2026-11-20");
    });

    it("is null when nothing is far enough out", () => {
        expect(frontMonthExpiry(expiries.slice(0, 2), now)).toBeNull();
    });
});

describe("ivRank", () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5].map((iv) => ({iv}));

    it("scales between the recorded low and high", () => {
        const result = ivRank(history, 0.3);
        expect(result.rank).toBeCloseTo(0.5, 8);
        expect(result.percentile).toBeCloseTo(0.6, 8);
        expect(result.low).toBe(0.1);
        expect(result.high).toBe(0.5);
    });

    it("sits mid-range when the history is flat", () => {
        expect(ivRank([{iv: 0.2}, {iv: 0.2}], 0.2).rank).toBe(0.5);
    });
});
