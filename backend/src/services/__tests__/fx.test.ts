import {describe, expect, it} from "vitest";
import {fxBarDate, isWeekendDate} from "../fx";

function key(date: Date) {
    return date.toISOString().slice(0, 10);
}

describe("fxBarDate", () => {
    it("files a summer-time bar stamped 23:00 UTC under the next London day", () => {
        // Yahoo's Monday 2026-09-28 bar
        expect(key(fxBarDate(new Date("2026-09-27T23:00:00Z")))).toBe("2026-09-28");
        // Friday 2026-09-25 bar
        expect(key(fxBarDate(new Date("2026-09-24T23:00:00Z")))).toBe("2026-09-25");
    });

    it("keeps the UTC day in winter, when London is on UTC", () => {
        expect(key(fxBarDate(new Date("2026-12-01T00:00:00Z")))).toBe("2026-12-01");
    });

    it("dates an intraday quote by its London day", () => {
        expect(key(fxBarDate(new Date("2026-10-02T03:10:44Z")))).toBe("2026-10-02");
    });

    it("returns a UTC-midnight date", () => {
        expect(fxBarDate(new Date("2026-09-27T23:00:00Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
    });
});

describe("isWeekendDate", () => {
    it("flags Saturday and Sunday only", () => {
        expect(isWeekendDate(new Date("2026-09-26T00:00:00Z"))).toBe(true);
        expect(isWeekendDate(new Date("2026-09-27T00:00:00Z"))).toBe(true);
        expect(isWeekendDate(new Date("2026-09-28T00:00:00Z"))).toBe(false);
    });
});
