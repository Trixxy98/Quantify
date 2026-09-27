import {describe, expect, it} from "vitest";
import {
    assignWeights,
    momentumConclusion,
    momentumSignal,
    monthEnds,
    runMomentum,
    topThirdCount,
} from "../momentum";

function businessDays(year: number, months: number): string[] {
    const dates: string[] = [];
    const cursor = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, months, 0));
    while (cursor <= end) {
        const day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

describe("monthEnds", () => {
    it("uses the last session of the month when the calendar day is missing", () => {
        const ends = monthEnds(["2024-01-30", "2024-01-31", "2024-02-01", "2024-02-29"]);
        expect(ends.map((month) => month.date)).toEqual(["2024-01-31", "2024-02-29"]);
    });

    it("steps back to the previous session when the month ends on a holiday", () => {
        const ends = monthEnds(["2024-01-30", "2024-02-01"]);
        expect(ends[0]).toMatchObject({month: "2024-01", date: "2024-01-30"});
    });
});

describe("assignWeights", () => {
    const signals = [
        {symbol: "A", signal: 0.1},
        {symbol: "B", signal: 0.5},
        {symbol: "C", signal: -0.2},
    ];

    it("puts equal weight on the top third only", () => {
        expect(topThirdCount(30)).toBe(10);
        expect(topThirdCount(5)).toBe(1);
        expect(assignWeights(signals, false)).toEqual({B: 1});
    });

    it("shorts the bottom third without overlapping the longs", () => {
        expect(assignWeights(signals, true)).toEqual({B: 0.5, C: -0.5});
    });
});

describe("momentumSignal", () => {
    it("is the close one month before formation over the close twelve months before it", () => {
        const indexes = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140];
        const levels = Array.from({length: 141}, (_, index) => 100 + index);
        // Holding month 13 reads month-end indexes 0 and 11.
        expect(momentumSignal(levels, indexes, 13)).toBeCloseTo(levels[110] / levels[0] - 1, 8);
    });
});

describe("runMomentum", () => {
    const dates = businessDays(2020, 18);
    const ends = monthEnds(dates);

    function panel(spikeOn: string | null, symbol: 0 | 1 = 0): number[][] {
        const rows = [dates.map(() => 100), dates.map(() => 100)];
        if (spikeOn) {
            const at = dates.indexOf(spikeOn);
            if (at >= 0) rows[symbol][at] = 300;
        }
        return rows;
    }

    it("changes the book when the formation-month price moves, and ignores the same move one day later", () => {
        const formationEnd = ends[11].date;
        const dayAfter = dates[dates.indexOf(formationEnd) + 1];
        const onTime = runMomentum(dates, ["WIN", "FLAT"], panel(formationEnd, 0), false, 0, 0);
        const late = runMomentum(dates, ["WIN", "FLAT"], panel(dayAfter, 0), false, 0, 0);
        expect(onTime.months[0].long).toEqual(["WIN"]);
        expect(late.months[0].long).toEqual(["FLAT"]);
    });

    it("does not change the weights when only the holding month is rewritten", () => {
        const holding = ends[ends.length - 1].date;
        const clean = runMomentum(dates, ["WIN", "FLAT"], panel(null), false, 0, 0);
        const rewritten = runMomentum(dates, ["WIN", "FLAT"], panel(holding, 0), false, 0, 0);
        expect(rewritten.months.map((month) => month.long)).toEqual(clean.months.map((month) => month.long));
    });

    it("charges the entry turnover once and not again when the book does not change", () => {
        const levels = [dates.map((_, index) => 100 + index)];
        const run = runMomentum(dates, ["ONLY"], levels, false, 5, 5);
        expect(run.months[0].turnover).toBeCloseTo(1, 8);
        expect(run.months[1].turnover).toBeCloseTo(0, 8);
        const firstDay = run.days.find((day) => day.date.slice(0, 7) === run.months[0].month)!;
        const gross = levels[0][dates.indexOf(firstDay.date)] / levels[0][dates.indexOf(firstDay.date) - 1] - 1;
        expect(firstDay.strategy).toBeCloseTo(gross - 0.001, 8);
    });
});

describe("momentumConclusion", () => {
    it("says so when the signal loses to buy-and-hold", () => {
        expect(momentumConclusion(0.04, 0.11, 500, 30)).toContain("does not beat buy-and-hold after costs");
    });
});
