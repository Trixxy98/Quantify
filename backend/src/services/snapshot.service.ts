import {TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {currencyFromSymbol} from "./market.service";
import {adjustTrade, loadDividends, loadSplits} from "./corporateActions";
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
    const splitsBySymbol = await loadSplits(symbols);
    const dividendsBySymbol = await loadDividends(symbols);

    // Flat, time-ordered dividend events so the calendar walk below can pay
    // each one against whatever quantity was held when it went ex.
    const dividendEvents: {time: number; symbol: string; amount: number}[] = [];
    for (const [symbol, rows] of dividendsBySymbol) {
        for (const row of rows) {
            dividendEvents.push({time: row.exDate.getTime(), symbol, amount: row.amount});
        }
    }
    dividendEvents.sort((a, b) => a.time - b.time);

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

    // Anything that went ex before the portfolio existed is not ours to collect
    let divIndex = 0;
    while (divIndex < dividendEvents.length && dividendEvents[divIndex].time < calendar[0]) {
        divIndex++;
    }

    function toBase(value: number, currency: typeof baseCurrency, time: number) {
        return convertToBase(value, currency, baseCurrency, rateSeries, time);
    }

    const qtyBySymbol = new Map<string, number>();
    const costBySymbol = new Map<string, number>();
    let txIndex = 0;
    const snapshots: {date: Date; totalValue: number; totalCost: number; dividendIncome: number}[] =
        [];

    for (const time of calendar) {
        // All transactions up to this date
        while (txIndex < transactions.length && transactions[txIndex].date.getTime() <= time) {
            const t = transactions[txIndex];
            // Prices are on Yahoo's post-split basis; the trade is not
            const {quantity: q} = adjustTrade(
                Number(t.quantity),
                Number(t.price),
                splitsBySymbol.get(t.symbol) ?? [],
                t.date.getTime()
            );
            const currentQty = qtyBySymbol.get(t.symbol) ?? 0;
            const currentCost = costBySymbol.get(t.symbol) ?? 0;

            const currency = t.currency;
            if (t.type === TransactionType.BUY) {
                const nativeCost = Number(t.quantity) * Number(t.price) + Number(t.fee);
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

        // Dividends that went ex on or before this date and after the previous
        // one. Quantities above are already updated for trades up to `time`.
        let dividendIncome = 0;
        while (divIndex < dividendEvents.length && dividendEvents[divIndex].time <= time) {
            const event = dividendEvents[divIndex];
            const held = qtyBySymbol.get(event.symbol) ?? 0;
            if (held > 0) {
                const income = toBase(
                    held * event.amount,
                    currencyFromSymbol(event.symbol),
                    time
                );
                if (income != null) dividendIncome += income;
            }
            divIndex++;
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
        snapshots.push({date: new Date(time), totalValue, totalCost, dividendIncome});
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
                update: {
                    totalValue: snapshot.totalValue,
                    totalCost: snapshot.totalCost,
                    dividendIncome: snapshot.dividendIncome,
                },
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