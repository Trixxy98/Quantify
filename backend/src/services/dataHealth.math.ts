export type HealthStatus = "ok" | "warn" | "bad";

const RANK: Record<HealthStatus, number> = {ok: 0, warn: 1, bad: 2};
const DAY_MS = 24 * 60 * 60 * 1000;
/** Splits smaller than this are indistinguishable from an ordinary day's move. */
const MIN_SPLIT_LOG_RATIO = Math.log(1.05);
/** IV gaps older than this many sessions are listed but no longer colour the row. */
export const IV_RECENT_SESSIONS = 20;
const SHOWN_DATES = 5;

export function worst(statuses: HealthStatus[]): HealthStatus {
    return statuses.reduce<HealthStatus>((acc, status) => (RANK[status] > RANK[acc] ? status : acc), "ok");
}

export function statusRank(status: HealthStatus): number {
    return RANK[status];
}

/** Weekdays d with after < d <= through, both YYYY-MM-DD. */
export function weekdaysAfter(after: string, through: string): number {
    let count = 0;
    const end = Date.parse(`${through}T00:00:00Z`);
    for (let day = Date.parse(`${after}T00:00:00Z`) + DAY_MS; day <= end; day += DAY_MS) {
        const weekday = new Date(day).getUTCDay();
        if (weekday !== 0 && weekday !== 6) count += 1;
    }
    return count;
}

/**
 * Sessions between the last bar and the expected latest session. Calendar
 * sessions count first, so past holidays are not counted; weekdays cover the
 * stretch the calendar itself has not reached yet.
 */
export function staleSessions(last: string, calendar: string[], expected: string): number {
    const calendarLast = calendar.length > 0 ? calendar[calendar.length - 1] : last;
    const behindCalendar = calendar.filter((date) => date > last).length;
    return behindCalendar + weekdaysAfter(calendarLast > last ? calendarLast : last, expected);
}

export function isWeekend(date: string): boolean {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return weekday === 0 || weekday === 6;
}

/**
 * Index dates minus the ones where at least two of the market's series were
 * live and none of them has a bar. Yahoo sometimes prints an index bar on an
 * exchange holiday (^KLSE on Agong's Birthday), which would otherwise mark
 * every stock as missing that day.
 */
export function tradedCalendar(indexDates: string[], series: Set<string>[]): {calendar: string[]; dropped: string[]} {
    const ranges = series
        .filter((dates) => dates.size > 0)
        .map((dates) => {
            const sorted = [...dates].sort();
            return {dates, first: sorted[0], last: sorted[sorted.length - 1]};
        });
    const calendar: string[] = [];
    const dropped: string[] = [];
    for (const date of indexDates) {
        const live = ranges.filter((range) => date >= range.first && date <= range.last);
        if (live.length >= 2 && live.every((range) => !range.dates.has(date))) dropped.push(date);
        else calendar.push(date);
    }
    return {calendar, dropped};
}

/** Calendar sessions inside [first, last] with no row. */
export function missingFromCalendar(have: Set<string>, calendar: string[], first: string, last: string): string[] {
    return calendar.filter((date) => date >= first && date <= last && !have.has(date));
}

/**
 * Split dates where the stored closes still jump by the split ratio, i.e. the
 * history before the split was never rebased. On an adjusted series the
 * day-over-day log move sits near 0; on a stale one it sits near ln(den/num).
 */
export function splitCliffs(
    bars: {date: string; close: number}[],
    splits: {date: string; numerator: number; denominator: number}[]
): string[] {
    const cliffs: string[] = [];
    for (const split of splits) {
        const ratio = Math.log(split.denominator / split.numerator);
        if (!Number.isFinite(ratio) || Math.abs(ratio) < MIN_SPLIT_LOG_RATIO) continue;
        const index = bars.findIndex((bar) => bar.date >= split.date);
        if (index <= 0) continue;
        const move = Math.log(bars[index].close / bars[index - 1].close);
        if (Math.abs(move - ratio) < Math.abs(move)) cliffs.push(split.date);
    }
    return cliffs;
}

export function stalenessStatus(sessions: number): HealthStatus {
    if (sessions <= 0) return "ok";
    return sessions === 1 ? "warn" : "bad";
}

export function gapStatus(count: number): HealthStatus {
    if (count === 0) return "ok";
    return count < 3 ? "warn" : "bad";
}

function latest(dates: string[]): string[] {
    return dates.slice(-SHOWN_DATES).reverse();
}

export type PriceAssessment = {
    bars: number;
    firstDate: string | null;
    lastDate: string | null;
    staleSessions: number | null;
    missingSessions: number;
    missingRecent: string[];
    weekendRows: number;
    splitCliffs: string[];
    dividendsWithoutBar: string[];
    status: HealthStatus;
    issues: string[];
};

/**
 * Checks one stored daily series against its exchange calendar. Pass
 * `isCalendar` for the series that defines the calendar, which cannot miss
 * sessions against itself.
 */
export function assessPriceSeries(input: {
    bars: {date: string; close: number}[];
    calendar: string[];
    expected: string;
    splits?: {date: string; numerator: number; denominator: number}[];
    exDates?: string[];
    isCalendar?: boolean;
}): PriceAssessment {
    const {bars, calendar, expected} = input;
    if (bars.length === 0) {
        return {
            bars: 0,
            firstDate: null,
            lastDate: null,
            staleSessions: null,
            missingSessions: 0,
            missingRecent: [],
            weekendRows: 0,
            splitCliffs: [],
            dividendsWithoutBar: [],
            status: "bad",
            issues: ["No price bars stored. Run a sync."],
        };
    }

    const first = bars[0].date;
    const last = bars[bars.length - 1].date;
    const have = new Set(bars.map((bar) => bar.date));
    const statuses: HealthStatus[] = [];
    const issues: string[] = [];

    const weekendRows = bars.filter((bar) => isWeekend(bar.date)).map((bar) => bar.date);
    if (weekendRows.length > 0) {
        statuses.push("bad");
        issues.push(
            `${weekendRows.length} row${weekendRows.length === 1 ? "" : "s"} dated on a weekend (${latest(weekendRows).join(", ")}). The source stamps bars in another time zone, so rows sit a day early and lookups on a date read the next session.`
        );
    }

    const stale = input.isCalendar ? weekdaysAfter(last, expected) : staleSessions(last, calendar, expected);
    statuses.push(stalenessStatus(stale));
    if (stale > 0) issues.push(`${stale} session${stale === 1 ? "" : "s"} behind; last bar ${last}, expected ${expected}.`);

    const missing = input.isCalendar ? [] : missingFromCalendar(have, calendar, first, last);
    statuses.push(gapStatus(missing.length));
    if (missing.length > 0) {
        issues.push(`${missing.length} exchange session${missing.length === 1 ? "" : "s"} with no bar, latest ${missing[missing.length - 1]}.`);
    }

    const cliffs = splitCliffs(bars, input.splits ?? []);
    if (cliffs.length > 0) {
        statuses.push("bad");
        issues.push(`Closes still jump by the split ratio on ${cliffs.join(", ")}; history before it was not rebased.`);
    }

    const orphanDividends = (input.exDates ?? []).filter((date) => date >= first && date <= last && !have.has(date));
    if (orphanDividends.length > 0) {
        statuses.push("warn");
        issues.push(
            `${orphanDividends.length} dividend${orphanDividends.length === 1 ? "" : "s"} go ex on a day with no bar (${latest(orphanDividends).join(", ")}); TWR books them on no snapshot.`
        );
    }

    return {
        bars: bars.length,
        firstDate: first,
        lastDate: last,
        staleSessions: stale,
        missingSessions: missing.length,
        missingRecent: latest(missing),
        weekendRows: weekendRows.length,
        splitCliffs: cliffs,
        dividendsWithoutBar: orphanDividends,
        status: worst(statuses),
        issues,
    };
}

export type IvAssessment = {
    recorded: number;
    lastDate: string | null;
    missed: number;
    missedRecent: string[];
    status: HealthStatus;
    issues: string[];
};

/**
 * Implied-vol rows against the US calendar from the first recording on. Gaps
 * are permanent, so only the last IV_RECENT_SESSIONS colour the row.
 */
export function assessIvRecording(input: {recorded: string[]; calendar: string[]; expected: string}): IvAssessment {
    const recorded = [...input.recorded].sort();
    if (recorded.length === 0) {
        return {
            recorded: 0,
            lastDate: null,
            missed: 0,
            missedRecent: [],
            status: "warn",
            issues: ["No implied vol recorded yet. The next sync starts it."],
        };
    }

    const first = recorded[0];
    const last = recorded[recorded.length - 1];
    const calendarEnd = input.calendar.length > 0 ? input.calendar[input.calendar.length - 1] : last;
    const missed = missingFromCalendar(new Set(recorded), input.calendar, first, calendarEnd);
    const recentWindow = new Set(input.calendar.slice(-IV_RECENT_SESSIONS));
    const missedRecent = missed.filter((date) => recentWindow.has(date)).length;

    const statuses: HealthStatus[] = [gapStatus(missedRecent)];
    const issues: string[] = [];
    if (last < input.expected) {
        statuses.push("warn");
        issues.push(`No implied vol for the ${input.expected} session yet; last recorded ${last}.`);
    }
    if (missed.length > 0) {
        issues.push(
            `${missed.length} US session${missed.length === 1 ? "" : "s"} since ${first} have no IV row (${latest(missed).join(", ")}); they cannot be backfilled.`
        );
    }

    return {
        recorded: recorded.length,
        lastDate: last,
        missed: missed.length,
        missedRecent: latest(missed),
        status: worst(statuses),
        issues,
    };
}
