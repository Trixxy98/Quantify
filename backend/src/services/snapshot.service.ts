import {Currency, TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {currencyFromSymbol} from "./market.service";

type PricePoint = {date: number, close: number};

// Harga penutup terakhir pada atau sebelum `time` — forward-fill untuk
// hari cuti pasaran (contoh: Bursa cuti tapi US buka)
function latestCloseAtOrBefore(series: PricePoint[], time: number): number | null {
    let result: number | null = null;
    for (const point of series) {
        if (point.date > time) break;
        result = point.close;
    }
    return result;
}

export async function rebuildSnapshots(portfolioId: string) {
    const portfolio = await prisma.portfolio.findUnique({where: {id: portfolioId}});
    if (!portfolio) return 0;

    const transactions = await prisma.transaction.findMany({
        where: {portfolioId},
        orderBy: [{date: "asc"}, {createdAt: "asc"}],
    });
    if (transactions.length === 0) return 0;

    const symbols = [...new Set(transactions.map((t) => t.symbol))];
    const firstDate = transactions[0].date;

    const prices = await prisma.dailyPrice.findMany({
        where: {symbol: {in: symbols}, date: {gte: firstDate}},
        orderBy: {date: "asc"},
    });

    const rates = await prisma.exchangeRate.findMany({
        where: {from: Currency.USD, to: Currency.MYR},
        orderBy: {date: "asc"},
    });
    const rateSeries: PricePoint[] = rates.map((r) => ({
        date: r.date.getTime(),
        close: Number(r.rate),
    }));

    // Siri harga per symbol + kalendar (union semua trading day)
    const priceMap = new Map<string, PricePoint[]>();
    const calendarSet = new Set<number>();
    for (const p of prices) {
        const time = p.date.getTime();
        calendarSet.add(time);
        if (!priceMap.has(p.symbol)) priceMap.set(p.symbol, []);
        priceMap.get(p.symbol)!.push({date: time, close: Number(p.close)});
    }
    const calendar = [...calendarSet].sort((a,b) => a-b);

    function toBase(value: number, currency: Currency, time: number): number {
        if (currency === portfolio!.baseCurrency) return value;
        const rate = latestCloseAtOrBefore(rateSeries, time);
        if (rate == null) return value;
        return currency === Currency.USD ? value * rate : value / rate;
    }

    const qtyBySymbol = new Map<string, number>();
    const costBySymbol = new Map<string, number>();
    let txIndex = 0;
    const snapshots: {date: Date; totalValue: number; totalCost: number}[] = [];

    for (const time of calendar) {
        //Apply semua transaksi sehingga tarikh ini
        while (txIndex < transactions.length && transactions[txIndex].date.getTime() <= time) {
            const t = transactions[txIndex];
            const q = Number(t.quantity);
            const currentQty = qtyBySymbol.get(t.symbol) ?? 0;
            const currentCost = costBySymbol.get(t.symbol) ?? 0;

            if (t.type === TransactionType.BUY) {
                qtyBySymbol.set(t.symbol, currentQty + q);
                costBySymbol.set(t.symbol, currentCost + q * Number(t.price) + Number(t.fee));
            } else {
                const avgCost = currentQty > 0 ? currentCost / currentQty : 0;
                qtyBySymbol.set(t.symbol, currentQty - q);
                costBySymbol.set(t.symbol, currentCost - q * avgCost);
            }
            txIndex++;
        }

        let totalValue = 0;
        let totalCost = 0;
        for (const symbol of symbols) {
            const quantity = qtyBySymbol.get(symbol) ?? 0;
            if (quantity <= 0) continue;

            const close = latestCloseAtOrBefore(priceMap.get(symbol) ?? [], time);
            if (close == null) continue;

            const currency = currencyFromSymbol(symbol);
            totalValue += toBase(quantity * close, currency, time);
            totalCost += toBase(costBySymbol.get(symbol) ?? 0, currency, time);
        }

        snapshots.push({date: new Date(time), totalValue, totalCost});
    }

    // Upsert (bukan skipDuplicates) — rebuild selepas transaction baru/padam
    // perlu refresh nilai snapshot lama juga
    for (const snapshot of snapshots) {
        await prisma.portfolioSnapshot.upsert({
            where: {portfolioId_date: {portfolioId, date: snapshot.date}},
            create: {portfolioId, ...snapshot},
            update: {totalValue: snapshot.totalValue, totalCost: snapshot.totalCost},
        });
    }

    return snapshots.length;
}

export async function rebuildAllSnapshots() {
    const portfolios = await prisma.portfolio.findMany({select: {id: true}});
    for (const portfolio of portfolios) {
        await rebuildSnapshots(portfolio.id);
    }
    return portfolios.length;
}