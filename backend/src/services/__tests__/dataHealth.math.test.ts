import {describe, expect, it} from "vitest";
import {
    assessIvRecording,
    assessPriceSeries,
    missingFromCalendar,
    splitCliffs,
    staleSessions,
    tradedCalendar,
    weekdaysAfter,
    worst,
} from "../dataHealth.math";

// Thu 24 Sep 2026 .. Fri 2 Oct 2026, weekdays only
const CALENDAR = ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];

function bars(dates: string[], close = 100) {
    return dates.map((date) => ({date, close}));
}

describe("weekdaysAfter", () => {
    it("does not count the weekend", () => {
        expect(weekdaysAfter("2026-09-25", "2026-09-28")).toBe(1);
        expect(weekdaysAfter("2026-09-25", "2026-09-27")).toBe(0);
    });

    it("is zero when the start is on or after the end", () => {
        expect(weekdaysAfter("2026-10-02", "2026-10-01")).toBe(0);
        expect(weekdaysAfter("2026-10-01", "2026-10-01")).toBe(0);
    });
});

describe("staleSessions", () => {
    it("is zero across a weekend when Friday is the latest session", () => {
        expect(staleSessions("2026-09-25", CALENDAR.slice(0, 2), "2026-09-25")).toBe(0);
    });

    it("counts calendar sessions after the last bar", () => {
        expect(staleSessions("2026-09-25", CALENDAR, "2026-10-02")).toBe(5);
    });

    it("adds weekdays the calendar itself has not reached", () => {
        expect(staleSessions("2026-09-25", CALENDAR.slice(0, 3), "2026-09-30")).toBe(3);
    });

    it("skips a holiday the calendar knows about", () => {
        const withHoliday = CALENDAR.filter((date) => date !== "2026-09-28");
        expect(staleSessions("2026-09-25", withHoliday.slice(0, 3), "2026-09-29")).toBe(1);
    });
});

describe("missingFromCalendar", () => {
    it("finds the one removed session inside the series range only", () => {
        const have = new Set(CALENDAR.filter((date) => date !== "2026-09-29"));
        have.delete("2026-09-24");
        expect(missingFromCalendar(have, CALENDAR, "2026-09-25", "2026-10-02")).toEqual(["2026-09-29"]);
    });
});

describe("splitCliffs", () => {
    const split = {date: "2026-09-29", numerator: 4, denominator: 1};

    it("flags a 4:1 split the stored history was not rebased for", () => {
        const series = [
            {date: "2026-09-25", close: 400},
            {date: "2026-09-28", close: 404},
            {date: "2026-09-29", close: 101},
        ];
        expect(splitCliffs(series, [split])).toEqual(["2026-09-29"]);
    });

    it("passes an adjusted series", () => {
        const series = [
            {date: "2026-09-25", close: 100},
            {date: "2026-09-28", close: 101},
            {date: "2026-09-29", close: 101.5},
        ];
        expect(splitCliffs(series, [split])).toEqual([]);
    });

    it("ignores splits before the first stored bar", () => {
        expect(splitCliffs(bars(["2026-09-29", "2026-09-30"]), [split])).toEqual([]);
    });
});

describe("assessPriceSeries", () => {
    it("is ok for a complete, current series", () => {
        const result = assessPriceSeries({bars: bars(CALENDAR), calendar: CALENDAR, expected: "2026-10-02"});
        expect(result.status).toBe("ok");
        expect(result.issues).toEqual([]);
    });

    it("is bad when two sessions behind", () => {
        const result = assessPriceSeries({bars: bars(CALENDAR.slice(0, 5)), calendar: CALENDAR, expected: "2026-10-02"});
        expect(result.staleSessions).toBe(2);
        expect(result.status).toBe("bad");
    });

    it("warns on one missing session and a dividend with no bar", () => {
        const dates = CALENDAR.filter((date) => date !== "2026-09-29");
        const result = assessPriceSeries({
            bars: bars(dates),
            calendar: CALENDAR,
            expected: "2026-10-02",
            exDates: ["2026-09-29"],
        });
        expect(result.missingSessions).toBe(1);
        expect(result.dividendsWithoutBar).toEqual(["2026-09-29"]);
        expect(result.status).toBe("warn");
    });

    it("does not check the calendar series against itself", () => {
        const result = assessPriceSeries({
            bars: bars(CALENDAR.slice(0, 6)),
            calendar: CALENDAR.slice(0, 6),
            expected: "2026-10-02",
            isCalendar: true,
        });
        expect(result.missingSessions).toBe(0);
        expect(result.staleSessions).toBe(1);
        expect(result.status).toBe("warn");
    });

    it("is bad with no bars at all", () => {
        expect(assessPriceSeries({bars: [], calendar: CALENDAR, expected: "2026-10-02"}).status).toBe("bad");
    });
});

describe("assessIvRecording", () => {
    it("lists missed sessions from the first recording and colours recent ones", () => {
        const result = assessIvRecording({
            recorded: ["2026-09-25", "2026-10-01"],
            calendar: CALENDAR.slice(0, 6),
            expected: "2026-10-01",
        });
        expect(result.missed).toBe(3);
        expect(result.missedRecent).toEqual(["2026-09-30", "2026-09-29", "2026-09-28"]);
        expect(result.status).toBe("bad");
    });

    it("warns when the latest session is not recorded yet", () => {
        const result = assessIvRecording({recorded: CALENDAR.slice(0, 6), calendar: CALENDAR.slice(0, 6), expected: "2026-10-02"});
        expect(result.missed).toBe(0);
        expect(result.status).toBe("warn");
    });
});

describe("tradedCalendar", () => {
    it("drops an index bar no live stock traded on", () => {
        const holiday = "2026-09-29";
        const stock = new Set(CALENDAR.filter((date) => date !== holiday));
        const result = tradedCalendar(CALENDAR, [stock, new Set(stock)]);
        expect(result.dropped).toEqual([holiday]);
        expect(result.calendar).not.toContain(holiday);
    });

    it("keeps the date when only one series is live, so its own gap still shows", () => {
        const stock = new Set(CALENDAR.filter((date) => date !== "2026-09-29"));
        expect(tradedCalendar(CALENDAR, [stock]).dropped).toEqual([]);
    });
});

describe("weekend rows", () => {
    it("flags bars stamped on a Sunday as a time-zone shift", () => {
        const result = assessPriceSeries({
            bars: bars(["2026-09-27", "2026-09-28", "2026-09-29"]),
            calendar: ["2026-09-28", "2026-09-29"],
            expected: "2026-09-29",
        });
        expect(result.weekendRows).toBe(1);
        expect(result.status).toBe("bad");
    });
});

describe("worst", () => {
    it("picks the most severe status", () => {
        expect(worst(["ok", "warn", "ok"])).toBe("warn");
        expect(worst(["warn", "bad"])).toBe("bad");
        expect(worst([])).toBe("ok");
    });
});
