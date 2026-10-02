const NEW_YORK = "America/New_York";
/** 16:00 close plus a quarter hour for Yahoo to publish the bar. */
const CLOSE_MINUTES = 16 * 60 + 15;
const DAY_MS = 24 * 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
});

function newYorkParts(date: Date) {
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
 * The instant the most recent US weekday session closed, at or before `now`.
 * Exchange holidays are treated as sessions: a sync after one finds no new bar
 * and is recorded, so it does not repeat.
 */
export function latestUsSessionClose(now: Date): Date {
    const parts = newYorkParts(now);
    const offsetMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(now.getTime() / 60_000) * 60_000;

    let year = parts.year;
    let month = parts.month;
    let day = parts.day;
    let weekday = parts.weekday;
    const beforeClose = parts.hour * 60 + parts.minute < CLOSE_MINUTES;

    let step = beforeClose || weekday === "Sat" || weekday === "Sun";
    while (step) {
        const previous = new Date(Date.UTC(year, month - 1, day) - DAY_MS);
        year = previous.getUTCFullYear();
        month = previous.getUTCMonth() + 1;
        day = previous.getUTCDate();
        weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][previous.getUTCDay()];
        step = weekday === "Sat" || weekday === "Sun";
    }

    const wallClose = Date.UTC(year, month - 1, day, Math.floor(CLOSE_MINUTES / 60), CLOSE_MINUTES % 60);
    return new Date(wallClose - offsetMs);
}
