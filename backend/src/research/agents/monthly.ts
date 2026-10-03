import {monthEnds} from "../momentum";
import type {SymbolSeries} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A month end more than this many days before the month's latest one is a stale or missing bar. */
export const FRESH_DAYS = 4;

/**
 * Month ends of one symbol. `feature` is the session before the month end:
 * forecasts are issued at the month-end close, and lagging the inputs one
 * session means they could have been computed before that close.
 */
export type SymbolMonth = {month: string; date: string; index: number; feature: number};

export function symbolMonths(series: SymbolSeries): Map<string, SymbolMonth> {
    const out = new Map<string, SymbolMonth>();
    for (const end of monthEnds(series.dates)) {
        if (end.index < 1) continue;
        out.set(end.month, {...end, feature: end.index - 1});
    }
    return out;
}

export function shiftMonth(month: string, by: number): string {
    const [year, mon] = month.split("-").map(Number);
    const total = year * 12 + (mon - 1) + by;
    const y = Math.floor(total / 12);
    const m = total % 12 + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
}

export function monthDistance(from: string, to: string): number {
    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    return (ty - fy) * 12 + (tm - fm);
}

/** Latest month-end date per month across all symbols. */
export function latestMonthEnds(all: Map<string, SymbolMonth>[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const months of all) {
        for (const [month, end] of months) {
            const current = out.get(month);
            if (!current || end.date > current) out.set(month, end.date);
        }
    }
    return out;
}

/** True when `date` is within FRESH_DAYS of `reference` (both YYYY-MM-DD). */
export function isFresh(date: string, reference: string): boolean {
    return Date.parse(reference) - Date.parse(date) <= FRESH_DAYS * DAY_MS;
}

/** Month end for `month` only if it is not a stale bar compared with the other names. */
export function freshMonth(months: Map<string, SymbolMonth>, month: string, latest: Map<string, string>): SymbolMonth | null {
    const end = months.get(month);
    const reference = latest.get(month);
    if (!end || !reference || !isFresh(end.date, reference)) return null;
    return end;
}

export function mean(values: number[]): number {
    return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length;
}
