import {TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {currencyFromSymbol} from "./market.service";
import {latestAtOrBefore, loadUsdMyrSeries, toBase as convertToBase, type SeriesPoint} from "./fx";

export async function rebuildSnapshots(portfolioId: string) {
    const portfolio = await prisma.portfolio.findUnique({where: {id: portfolioId}});
    if (!portfolio) return 0;
    const baseCurrency = portfolio.baseCurrency;

    const transactions = await prisma.transaction.findMany({
        where: {portfolioId},
        orderBy: [{date: "asc"}, {createdAt: "asc"}],
    });
    if (transactions.length === 0) {
        // All transactions deleted — clear obsolete snapshots
        await prisma.portfolioSnapshot.deleteMany({where: {portfolioId}});
        return 0;
    }

    const symbols = [...new Set(transactions.map((t) => t.symbol))];
    const firstDate = transactions[0].date;

    const prices = await prisma.dailyPrice.findMany({
        where: {symbol: {in: symbols}, date: {gte: firstDate}},
        orderBy: {date: "asc"},
    });

    const rateSeries = await loadUsdMyrSeries();

    // Price series per symbol + calendar (union of trading days)
    const priceMap = new Map<string, SeriesPoint[]>();
    const calendarSet = new Set<number>();
    for (const p of prices) {
        const time = p.date.getTime();
        calendarSet.add(time);
        if (!priceMap.has(p.symbol)) priceMap.set(p.symbol, []);
        priceMap.get(p.symbol)!.push({date: time, close: Number(p.close)});
    }
    const calendar = [...calendarSet].sort((a,b) => a-b);

    function toBase(value: number, currency: typeof baseCurrency, time: number) {
        return convertToBase(value, currency, baseCurrency, rateSeries, time);
    }

    const qtyBySymbol = new Map<string, number>();
    const costBySymbol = new Map<string, number>();
    let txIndex = 0;
    const snapshots: {date: Date; totalValue: number; totalCost: number}[] = [];

    for (const time of calendar) {
        // All transactions up to this date
        while (txIndex < transactions.length && transactions[txIndex].date.getTime() <= time) {
            const t = transactions[txIndex];
            const q = Number(t.quantity);
            const currentQty = qtyBySymbol.get(t.symbol) ?? 0;
            const currentCost = costBySymbol.get(t.symbol) ?? 0;

            const currency = t.currency;
            if (t.type === TransactionType.BUY) {
                const nativeCost = q * Number(t.price) + Number(t.fee);
                const baseCost =
                    toBase(nativeCost, currency, t.date.getTime()) ??
                    toBase(nativeCost, currency, time);
                qtyBySymbol.set(t.symbol, currentQty + q);
                if (baseCost != null) {
                    costBySymbol.set(t.symbol, currentCost + baseCost);
                }
            } else {
                const avgCost = currentQty > 0 ? currentCost / currentQty : 0;
                qtyBySymbol.set(t.symbol, currentQty - q);
                costBySymbol.set(t.symbol, currentCost - q * avgCost);
            }
            txIndex++;
        }

        let totalValue = 0;
        let totalCost = 0;
        let rateAvailable = true;

        for (const symbol of symbols) {
            const quantity = qtyBySymbol.get(symbol) ?? 0;
            if (quantity <= 0) continue;

            const close = latestAtOrBefore(priceMap.get(symbol) ?? [], time);
            if (close == null) continue;

            const currency = currencyFromSymbol(symbol);
            const value = toBase(quantity * close, currency, time);
            if (value == null) {
                rateAvailable = false;
                break;
            }

            totalValue += value;
            totalCost += costBySymbol.get(symbol) ?? 0;
        }

        // Skip this date when FX is missing — do not persist a wrong value
        if (!rateAvailable) continue;
        snapshots.push({date: new Date(time), totalValue, totalCost});
    }

    if (snapshots.length === 0) {
        return 0;
    }

    const rebuiltDates = snapshots.map((snapshot) => snapshot.date);

    await prisma.$transaction(async (tx) => {
        await tx.portfolioSnapshot.deleteMany({
            where: {
                portfolioId,
                date: { notIn: rebuiltDates },
            },
        });

        for (const snapshot of snapshots) {
            await tx.portfolioSnapshot.upsert({
                where: {portfolioId_date: {portfolioId, date: snapshot.date}},
                create: {portfolioId, ...snapshot},
                update: {totalValue: snapshot.totalValue, totalCost: snapshot.totalCost},
            });
        }
    });

    return snapshots.length;
}

export async function rebuildAllSnapshots() {
    const portfolios = await prisma.portfolio.findMany({select: {id: true}});
    for (const portfolio of portfolios) {
        await rebuildSnapshots(portfolio.id);
    }
    return portfolios.length;
}