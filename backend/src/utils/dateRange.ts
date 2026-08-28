export type Range = "1M" | "3M" | "6M" | "1Y" | "YTD" | "ALL";

function addUtcMonths(date: Date, months: number): Date {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const rawMonth = month + months;
    const targetYear = year + Math.floor(rawMonth / 12);
    const targetMonth = ((rawMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

export function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function resolveRangeStart(range: Range): Date | null {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    switch (range) {
        case "1M": return addUtcMonths(d, -1);
        case "3M": return addUtcMonths(d, -3);
        case "6M": return addUtcMonths(d, -6);
        case "1Y": d.setUTCFullYear(d.getUTCFullYear() - 1); return d;
        case "YTD": return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        case "ALL": return null;
    }
}
