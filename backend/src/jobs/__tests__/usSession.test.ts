import {describe, expect, it} from "vitest";
import {latestUsSessionClose} from "../usSession";

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
