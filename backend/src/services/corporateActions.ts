import {prisma} from "../lib/prisma";

export type SplitRow = {date: Date; numerator: number; denominator: number};

// A restated series shows up as a step change on a date already stored. 0.5%
// sits far below the smallest real split (2:1) and far above rounding drift.
export const REBASE_TOLERANCE = 0.005;

/**
 * True when Yahoo now reports a materially different close for a date we
 * already stored, which means the series was restated (a split, or a vendor
 * revision) and every row outside the refresh window is on the old basis.
 */
export function isRebased(storedClose: number, fetchedClose: number): boolean {
    if (!(storedClose > 0) || !(fetchedClose > 0)) return false;
    return Math.abs(fetchedClose / storedClose - 1) > REBASE_TOLERANCE;
}

/**
 * Cumulative split ratio for splits that happened strictly AFTER `tradeTime`.
 *
 * Yahoo restates its whole price history in post-split terms, but a stored
 * transaction keeps the share count as it was actually traded. 100 shares
 * bought before a 4:1 split are 400 shares on today's basis, so every trade
 * has to be pushed through the splits that came after it.
 */
export function splitFactorAfter(splits: SplitRow[], tradeTime: number): number {
    let factor = 1;
    for (const split of splits) {
        if (split.denominator <= 0 || split.numerator <= 0) continue;
        if (split.date.getTime() > tradeTime) {
            factor *= split.numerator / split.denominator;
        }
    }
    return factor;
}

/** Restates one trade in post-split terms. Cost (quantity x price) is unchanged. */
export function adjustTrade(
    quantity: number,
    price: number,
    splits: SplitRow[],
    tradeTime: number
): {quantity: number; price: number} {
    const factor = splitFactorAfter(splits, tradeTime);
    if (factor === 1) return {quantity, price};
    return {quantity: quantity * factor, price: price / factor};
}

export async function loadSplits(symbols: string[]): Promise<Map<string, SplitRow[]>> {
    const bySymbol = new Map<string, SplitRow[]>();
    if (symbols.length === 0) return bySymbol;

    const rows = await prisma.stockSplit.findMany({
        where: {symbol: {in: symbols}},
        orderBy: {date: "asc"},
    });

    for (const row of rows) {
        const list = bySymbol.get(row.symbol) ?? [];
        list.push({date: row.date, numerator: row.numerator, denominator: row.denominator});
        bySymbol.set(row.symbol, list);
    }
    return bySymbol;
}

export type DividendRow = {exDate: Date; amount: number};

export async function loadDividends(symbols: string[]): Promise<Map<string, DividendRow[]>> {
    const bySymbol = new Map<string, DividendRow[]>();
    if (symbols.length === 0) return bySymbol;

    const rows = await prisma.dividend.findMany({
        where: {symbol: {in: symbols}},
        orderBy: {exDate: "asc"},
    });

    for (const row of rows) {
        const list = bySymbol.get(row.symbol) ?? [];
        list.push({exDate: row.exDate, amount: Number(row.amount)});
        bySymbol.set(row.symbol, list);
    }
    return bySymbol;
}
