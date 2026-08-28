import {Currency, Exchange, TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {currencyFromSymbol} from "./market.service";
import {loadUsdMyrSeries, toBase} from "./fx";

export type OpenPositionMark = {
    symbol: string;
    exchange: Exchange;
    currency: Currency;
    quantity: number;
    avgCost: number;
    baseCost: number;
    lastPrice: number | null;
    lastPriceDate: Date | null;
    marketValue: number | null;
    unrealizedPnL: number | null;
    unrealizedPnLPct: number | null;
};

function exchangeFromSymbol(symbol: string): Exchange {
    return symbol.toUpperCase().endsWith(".KL") ? Exchange.BURSA : Exchange.US;
}

// Open lots with cost in base currency at **trade-time FX** (same as snapshots)
// and market value at the **latest** FX. That is the portfolio P&L definition.
export async function markOpenPositions(
    portfolioId: string,
    baseCurrency: Currency
): Promise<OpenPositionMark[]> {
    const transactions = await prisma.transaction.findMany({
        where: {portfolioId},
        orderBy: [{date: "asc"}, {createdAt: "asc"}],
    });

    const series = await loadUsdMyrSeries();
    const lastFxTime = series.at(-1)?.date ?? Date.now();

    type Acc = {qty: number; nativeCost: number; baseCost: number; currency: Currency};
    const bySymbol = new Map<string, Acc>();

    for (const t of transactions) {
        const acc = bySymbol.get(t.symbol) ?? {
            qty: 0,
            nativeCost: 0,
            baseCost: 0,
            currency: t.currency,
        };
        const q = Number(t.quantity);

        if (t.type === TransactionType.BUY) {
            const native = q * Number(t.price) + Number(t.fee);
            const base =
                toBase(native, t.currency, baseCurrency, series, t.date.getTime()) ??
                toBase(native, t.currency, baseCurrency, series, lastFxTime);
            acc.qty += q;
            acc.nativeCost += native;
            if (base != null) acc.baseCost += base;
        } else if (acc.qty > 1e-9) {
            const avgNative = acc.nativeCost / acc.qty;
            const avgBase = acc.baseCost / acc.qty;
            acc.qty -= q;
            acc.nativeCost -= q * avgNative;
            acc.baseCost -= q * avgBase;
        }

        acc.currency = t.currency;
        bySymbol.set(t.symbol, acc);
    }

    const marks: OpenPositionMark[] = [];

    for (const [symbol, acc] of bySymbol) {
        if (acc.qty <= 1e-9) continue;

        const lastPrice = await prisma.dailyPrice.findFirst({
            where: {symbol},
            orderBy: {date: "desc"},
        });

        const currency = acc.currency ?? currencyFromSymbol(symbol);
        const avgCost = acc.qty > 0 ? acc.nativeCost / acc.qty : 0;
        let marketValue: number | null = null;
        let unrealizedPnL: number | null = null;
        let unrealizedPnLPct: number | null = null;

        if (lastPrice) {
            const close = Number(lastPrice.close);
            marketValue = toBase(acc.qty * close, currency, baseCurrency, series, lastFxTime);
            if (marketValue != null) {
                unrealizedPnL = marketValue - acc.baseCost;
                unrealizedPnLPct = acc.baseCost > 0 ? unrealizedPnL / acc.baseCost : 0;
            }
        }

        marks.push({
            symbol,
            exchange: exchangeFromSymbol(symbol),
            currency,
            quantity: acc.qty,
            avgCost,
            baseCost: acc.baseCost,
            lastPrice: lastPrice ? Number(lastPrice.close) : null,
            lastPriceDate: lastPrice?.date ?? null,
            marketValue,
            unrealizedPnL,
            unrealizedPnLPct,
        });
    }

    return marks.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
