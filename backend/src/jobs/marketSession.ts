export type Market = "US" | "BURSA";

/** Close plus a quarter hour for Yahoo to publish the bar. */
const SESSIONS: Record<Market, {timeZone: string; closeMinutes: number}> = {
    US: {timeZone: "America/New_York", closeMinutes: 16 * 60 + 15},
    BURSA: {timeZone: "Asia/Kuala_Lumpur", closeMinutes: 17 * 60 + 15},
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(date: Date, timeZone: string) {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            weekday: "short",
        });
        formatters.set(timeZone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        weekday: parts.weekday as string,
    };
}

/**
 * The most recent weekday session of `market` whose bar should exist at `now`.
 * Exchange holidays are treated as sessions: a sync after one finds no new bar
 * and is recorded, so it does not repeat.
 */
export function latestSession(now: Date, market: Market): {close: Date; date: string} {
    const {timeZone, closeMinutes} = SESSIONS[market];
    const parts = wallClock(now, timeZone);
    const offsetMs =
        Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(now.getTime() / 60_000) * 60_000;

    let day = Date.UTC(parts.year, parts.month - 1, parts.day);
    let weekday = parts.weekday;
    let step = parts.hour * 60 + parts.minute < closeMinutes || weekday === "Sat" || weekday === "Sun";
    while (step) {
        day -= DAY_MS;
        weekday = WEEKDAYS[new Date(day).getUTCDay()];
        step = weekday === "Sat" || weekday === "Sun";
    }

    return {
        close: new Date(day + closeMinutes * 60_000 - offsetMs),
        date: new Date(day).toISOString().slice(0, 10),
    };
}

export function latestUsSessionClose(now: Date): Date {
    return latestSession(now, "US").close;
}
