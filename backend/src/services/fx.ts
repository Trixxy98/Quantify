import {Currency} from "@prisma/client";
import {prisma} from "../lib/prisma";

export type SeriesPoint = {date: number; close: number};

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
