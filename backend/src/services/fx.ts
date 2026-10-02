import {Currency} from "@prisma/client";
import {prisma} from "../lib/prisma";

export type SeriesPoint = {date: number; close: number};

const londonDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

/**
 * Yahoo stamps daily FX bars at London midnight, which is 23:00 UTC the day
 * before during British Summer Time. Dating them by the UTC day would file
 * each rate one day early, so they are dated by the London day instead.
 */
export function fxBarDate(timestamp: Date): Date {
    return new Date(`${londonDay.format(timestamp)}T00:00:00.000Z`);
}

/** For UTC-midnight date-only values. FX does not trade on weekends. */
export function isWeekendDate(date: Date): boolean {
    const weekday = date.getUTCDay();
    return weekday === 0 || weekday === 6;
}

export function latestAtOrBefore(series: SeriesPoint[], time: number): number | null {
    let result: number | null = null;
    for (const point of series) {
        if (point.date > time) break;
        result = point.close;
    }
    return result;
}

export async function loadUsdMyrSeries(): Promise<SeriesPoint[]> {
    const rates = await prisma.exchangeRate.findMany({
        where: {from: Currency.USD, to: Currency.MYR},
        orderBy: {date: "asc"},
    });
    return rates.map((r) => ({date: r.date.getTime(), close: Number(r.rate)}));
}

export function toBase(
    value: number,
    from: Currency,
    base: Currency,
    series: SeriesPoint[],
    time: number
): number | null {
    if (from === base) return value;
    const rate = latestAtOrBefore(series, time);
    if (rate == null) return null;
    return from === Currency.USD ? value * rate : value / rate;
}
