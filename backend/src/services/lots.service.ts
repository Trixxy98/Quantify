import {Currency, TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {adjustTrade, loadSplits, type SplitRow} from "./corporateActions";
import {loadUsdMyrSeries, toBase} from "./fx";

export type LotTrade = {
    id: string;
    symbol: string;
    type: TransactionType;
    quantity: number;
    price: number;
    fee: number;
    date: Date;
    createdAt: Date;
    currency: Currency;
};

export type ToBaseFn = (value: number, from: Currency, time: number) => number | null;

export type SellRealization = {
    transactionId: string;
    symbol: string;
    quantity: number;
    avgCost: number;
    proceeds: number;
    cost: number;
    costBase: number;
    realizedPnL: number;
    realizedPnLPct: number;
    realizedPnLBase: number;
    closedPosition: boolean;
};

export type ClosedLot = {
    symbol: string;
    currency: Currency;
    openedAt: string;
    closedAt: string;
    quantity: number;
    cost: number;
    proceeds: number;
    realizedPnL: number;
    realizedPnLPct: number;
    realizedPnLBase: number;
};

type Cycle = {
    openedAt: Date;
    buyQty: number;
    costNative: number;
    costBase: number;
    proceedsNative: number;
    proceedsBase: number;
};

type Acc = {
    qty: number;
    nativeCost: number;
    baseCost: number;
    currency: Currency;
    cycle: Cycle | null;
};

function dateKey(date: Date): string {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
        .toISOString()
        .slice(0, 10);
}

/**
 * Weighted-average realized P&L. A closed lot is one round trip: first buy
 * after flat until the position is sold back to zero. Partial sells book
 * realized P&L but do not emit a lot until the book is flat.
 */
export function replayRealized(
    trades: LotTrade[],
    splitsBySymbol: Map<string, SplitRow[]>,
    toBaseFn: ToBaseFn
): {sells: Map<string, SellRealization>; lots: ClosedLot[]} {
    const sells = new Map<string, SellRealization>();
    const lots: ClosedLot[] = [];
    const bySymbol = new Map<string, Acc>();

    const ordered = [...trades].sort((a, b) => {
        const byDate = a.date.getTime() - b.date.getTime();
        if (byDate !== 0) return byDate;
        const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
        if (byCreated !== 0) return byCreated;
        return a.id.localeCompare(b.id);
    });

    for (const t of ordered) {
        const acc = bySymbol.get(t.symbol) ?? {
            qty: 0,
            nativeCost: 0,
            baseCost: 0,
            currency: t.currency,
            cycle: null,
        };
        const {quantity: q} = adjustTrade(
            t.quantity,
            t.price,
            splitsBySymbol.get(t.symbol) ?? [],
            t.date.getTime()
        );
        const convert = (value: number) =>
            toBaseFn(value, t.currency, t.date.getTime()) ?? 0;

        if (t.type === TransactionType.BUY) {
            const native = t.quantity * t.price + t.fee;
            const base = convert(native);
            if (acc.qty <= 1e-9) {
                acc.cycle = {
                    openedAt: t.date,
                    buyQty: 0,
                    costNative: 0,
                    costBase: 0,
                    proceedsNative: 0,
                    proceedsBase: 0,
                };
            }
            acc.qty += q;
            acc.nativeCost += native;
            acc.baseCost += base;
            if (acc.cycle) {
                acc.cycle.buyQty += q;
                acc.cycle.costNative += native;
                acc.cycle.costBase += base;
            }
        } else if (acc.qty > 1e-9) {
            const avgNative = acc.nativeCost / acc.qty;
            const avgBase = acc.baseCost / acc.qty;
            const proceeds = t.quantity * t.price - t.fee;
            const proceedsBase = convert(proceeds);
            const cost = q * avgNative;
            const costBase = q * avgBase;
            const realizedPnL = proceeds - cost;
            const realizedPnLBase = proceedsBase - costBase;
            const remaining = acc.qty - q;
            const closedPosition = remaining <= 1e-9;

            if (acc.cycle) {
                acc.cycle.proceedsNative += proceeds;
                acc.cycle.proceedsBase += proceedsBase;
            }

            sells.set(t.id, {
                transactionId: t.id,
                symbol: t.symbol,
                quantity: q,
                avgCost: avgNative,
                proceeds,
                cost,
                costBase,
                realizedPnL,
                realizedPnLPct: cost > 0 ? realizedPnL / cost : 0,
                realizedPnLBase,
                closedPosition,
            });

            acc.qty = Math.max(0, remaining);
            acc.nativeCost -= cost;
            acc.baseCost -= q * avgBase;

            if (closedPosition && acc.cycle) {
                const cycle = acc.cycle;
                lots.push({
                    symbol: t.symbol,
                    currency: acc.currency,
                    openedAt: dateKey(cycle.openedAt),
                    closedAt: dateKey(t.date),
                    quantity: cycle.buyQty,
                    cost: cycle.costNative,
                    proceeds: cycle.proceedsNative,
                    realizedPnL: cycle.proceedsNative - cycle.costNative,
                    realizedPnLPct:
                        cycle.costNative > 0
                            ? (cycle.proceedsNative - cycle.costNative) / cycle.costNative
                            : 0,
                    realizedPnLBase: cycle.proceedsBase - cycle.costBase,
                });
                acc.cycle = null;
                acc.qty = 0;
                acc.nativeCost = 0;
                acc.baseCost = 0;
            }
        }

        acc.currency = t.currency;
        bySymbol.set(t.symbol, acc);
    }

    lots.sort((a, b) => {
        const byClose = b.closedAt.localeCompare(a.closedAt);
        if (byClose !== 0) return byClose;
        return a.symbol.localeCompare(b.symbol);
    });

    return {sells, lots};
}

export async function realizePortfolio(portfolioId: string, baseCurrency: Currency) {
    const transactions = await prisma.transaction.findMany({
        where: {portfolioId},
        orderBy: [{date: "asc"}, {createdAt: "asc"}],
    });
    const trades: LotTrade[] = transactions.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        type: t.type,
        quantity: Number(t.quantity),
        price: Number(t.price),
        fee: Number(t.fee),
        date: t.date,
        createdAt: t.createdAt,
        currency: t.currency,
    }));
    const splitsBySymbol = await loadSplits([...new Set(trades.map((t) => t.symbol))]);
    const series = await loadUsdMyrSeries();
    const lastFxTime = series.at(-1)?.date ?? Date.now();

    const toBaseFn: ToBaseFn = (value, from, time) =>
        toBase(value, from, baseCurrency, series, time) ??
        toBase(value, from, baseCurrency, series, lastFxTime);

    return replayRealized(trades, splitsBySymbol, toBaseFn);
}
