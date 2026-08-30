import macroEvents from "../data/macroEvents.json";
import {AppError} from "../utils/AppError";
import {yahooFinance} from "./market.service";

export type EventType = "FOMC" | "CPI" | "EARNINGS";

export type EventDate = {
    symbol: string;
    date: string;
    label: string;
    surprisePercent: number | null;
};

// Yahoo lists filings, not press releases. If the filing sits within a few days of the
// one announcement date Yahoo does expose, we shift every filing by that measured lag.
const MAX_CALIBRATION_LAG_DAYS = 4;
const QUARTER_TO_FILING_MIN_DAYS = 10;
const QUARTER_TO_FILING_MAX_DAYS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

type SecFiling = {date?: string; type?: string; epochDate?: Date | number | string};
type EarningsHistoryRow = {quarter?: Date | number | string; surprisePercent?: number};

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function parseDate(value: Date | number | string | undefined): Date | null {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDays(dateKey: string, days: number): string {
    return toDateKey(new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * DAY_MS));
}

function dayGap(a: string, b: string): number {
    return Math.round(
        (new Date(`${a}T00:00:00.000Z`).getTime() - new Date(`${b}T00:00:00.000Z`).getTime()) / DAY_MS
    );
}

function inWindow(dateKey: string, fromKey: string, toKey: string): boolean {
    return dateKey >= fromKey && dateKey <= toKey;
}

function macroDates(type: "FOMC" | "CPI"): string[] {
    const dates = type === "FOMC" ? macroEvents.fomc : macroEvents.cpi;
    return [...dates].sort();
}

function macroLabel(type: "FOMC" | "CPI", dateKey: string): string {
    return type === "FOMC" ? `FOMC decision ${dateKey}` : `CPI release ${dateKey}`;
}

function noFilerMessage(symbol: string): string {
    return `${symbol} has no 10-Q / 10-K filings on Yahoo — earnings events only work for US filers. Try AAPL, MSFT or NVDA, or switch to Fed days.`;
}

/** Announcement dates for a US filer, derived from Yahoo's 10-Q / 10-K list. */
async function earningsDates(symbol: string): Promise<EventDate[]> {
    let summary: {secFilings?: {filings?: SecFiling[]}; calendarEvents?: unknown; earningsHistory?: unknown};
    try {
        summary = (await yahooFinance.quoteSummary(symbol, {
            modules: ["secFilings", "calendarEvents", "earningsHistory"],
        })) as typeof summary;
    } catch (err) {
        // ETFs, indices and most Bursa names have no fundamentals endpoint at all
        const message = err instanceof Error ? err.message : String(err);
        if (/fundamentals/i.test(message)) {
            throw new AppError(422, "NO_EVENTS", noFilerMessage(symbol));
        }
        console.error("[events] earnings lookup failed", symbol, err);
        throw new AppError(
            502,
            "EVENTS_UNAVAILABLE",
            `Could not load earnings filings for ${symbol} from Yahoo.`
        );
    }

    const filings = (summary.secFilings?.filings ?? [])
        .filter((f) => f.type === "10-Q" || f.type === "10-K")
        .map((f) => {
            const parsed = parseDate(f.epochDate) ?? parseDate(f.date);
            return parsed ? toDateKey(parsed) : null;
        })
        .filter((key): key is string => key != null)
        .sort();

    if (filings.length === 0) {
        throw new AppError(422, "NO_EVENTS", noFilerMessage(symbol));
    }

    const calendar = summary.calendarEvents as
        | {earnings?: {earningsCallDate?: (Date | number | string)[]}}
        | undefined;
    const lastCall = parseDate(calendar?.earnings?.earningsCallDate?.[0]);
    let lag = 0;
    if (lastCall) {
        const callKey = toDateKey(lastCall);
        for (const filing of filings) {
            const gap = dayGap(callKey, filing);
            if (Math.abs(gap) <= MAX_CALIBRATION_LAG_DAYS) {
                lag = gap;
                break;
            }
        }
    }

    const history = ((summary.earningsHistory as {history?: EarningsHistoryRow[]} | undefined)?.history ?? [])
        .map((row) => {
            const quarter = parseDate(row.quarter);
            return quarter && row.surprisePercent != null
                ? {quarter: toDateKey(quarter), surprisePercent: row.surprisePercent}
                : null;
        })
        .filter((row): row is {quarter: string; surprisePercent: number} => row != null);

    return filings.map((filing) => {
        const date = lag === 0 ? filing : shiftDays(filing, lag);
        const match = history.find((row) => {
            const gap = dayGap(date, row.quarter);
            return gap >= QUARTER_TO_FILING_MIN_DAYS && gap <= QUARTER_TO_FILING_MAX_DAYS;
        });
        return {
            symbol,
            date,
            label: `${symbol} earnings ${date}`,
            surprisePercent: match?.surprisePercent ?? null,
        };
    });
}

export async function resolveEventDates(
    type: EventType,
    symbols: string[],
    fromKey: string,
    toKey: string
): Promise<EventDate[]> {
    if (type === "EARNINGS") {
        const perSymbol = await Promise.all(symbols.map((symbol) => earningsDates(symbol)));
        const events = perSymbol.flat().filter((event) => inWindow(event.date, fromKey, toKey));
        if (events.length === 0) {
            throw new AppError(
                422,
                "NO_EVENTS",
                "No earnings filings inside this window. Try a longer history."
            );
        }
        return events.sort((a, b) => a.date.localeCompare(b.date));
    }

    const dates = macroDates(type).filter((date) => inWindow(date, fromKey, toKey));
    if (dates.length === 0) {
        if (type === "CPI") {
            throw new AppError(
                422,
                "NO_EVENTS",
                "No CPI release dates are loaded. BLS blocks automated fetches, so run `npm run events:cpi` on the API with FRED_API_KEY set. FOMC works out of the box."
            );
        }
        throw new AppError(422, "NO_EVENTS", "No FOMC decisions inside this window.");
    }

    return symbols
        .flatMap((symbol) =>
            dates.map((date) => ({symbol, date, label: macroLabel(type, date), surprisePercent: null}))
        )
        .sort((a, b) => a.date.localeCompare(b.date));
}
