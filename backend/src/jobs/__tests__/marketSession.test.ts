import {describe, expect, it} from "vitest";
import {latestSession, latestUsSessionClose} from "../marketSession";

describe("latestUsSessionClose", () => {
    it("is today's close once New York has passed 16:15", () => {
        // Thursday 2026-10-01 18:00 EDT
        expect(latestUsSessionClose(new Date("2026-10-01T22:00:00Z")).toISOString()).toBe("2026-10-01T20:15:00.000Z");
    });

    it("is the previous session before the close", () => {
        // Friday 2026-10-02 11:13 MYT = Thursday 23:13 EDT, after Thursday's close
        expect(latestUsSessionClose(new Date("2026-10-02T03:13:00Z")).toISOString()).toBe("2026-10-01T20:15:00.000Z");
        // Friday 2026-10-02 10:00 EDT, before Friday's close
        expect(latestUsSessionClose(new Date("2026-10-02T14:00:00Z")).toISOString()).toBe("2026-10-01T20:15:00.000Z");
    });

    it("skips back over the weekend to Friday", () => {
        // Monday 2026-09-28 09:00 EDT
        expect(latestUsSessionClose(new Date("2026-09-28T13:00:00Z")).toISOString()).toBe("2026-09-25T20:15:00.000Z");
        // Sunday 2026-09-27 12:00 EDT
        expect(latestUsSessionClose(new Date("2026-09-27T16:00:00Z")).toISOString()).toBe("2026-09-25T20:15:00.000Z");
    });

    it("uses the winter offset in standard time", () => {
        // Tuesday 2026-12-01 17:00 EST
        expect(latestUsSessionClose(new Date("2026-12-01T22:00:00Z")).toISOString()).toBe("2026-12-01T21:15:00.000Z");
    });
});

describe("latestSession for Bursa", () => {
    it("is the previous weekday before 17:15 MYT and today after", () => {
        // Friday 2026-10-02 11:21 MYT
        expect(latestSession(new Date("2026-10-02T03:21:00Z"), "BURSA")).toEqual({
            close: new Date("2026-10-01T09:15:00Z"),
            date: "2026-10-01",
        });
        // Friday 2026-10-02 18:00 MYT
        expect(latestSession(new Date("2026-10-02T10:00:00Z"), "BURSA").date).toBe("2026-10-02");
    });

    it("dates the session in its own time zone", () => {
        // Monday 2026-09-28 07:00 MYT is still Sunday in New York
        const now = new Date("2026-09-27T23:00:00Z");
        expect(latestSession(now, "BURSA").date).toBe("2026-09-25");
        expect(latestSession(now, "US").date).toBe("2026-09-25");
    });
});
