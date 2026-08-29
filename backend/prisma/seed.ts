import dotenv from "dotenv";
import {Currency, PrismaClient, TransactionType} from "@prisma/client";
import {recomputePortfolioHoldings} from "../src/services/portfolio.service";
import {refreshPortfolioAfterTrade} from "../src/services/refresh.service";

dotenv.config();

const prisma = new PrismaClient();

function utcDate(iso: string) {
    return new Date(`${iso}T00:00:00.000Z`);
}

function currencyFromSymbol(symbol: string): Currency {
    return symbol.endsWith(".KL") ? Currency.MYR : Currency.USD;
}

const SEED_EMAIL = process.env.SEED_EMAIL ?? "harith@gmail.com";

const TRADES: {
    symbol: string;
    type: TransactionType;
    quantity: number;
    price: number;
    fee: number;
    date: string;
}[] = [
    {symbol: "5347.KL", type: TransactionType.BUY, quantity: 200, price: 13.8, fee: 12, date: "2025-04-10"},
    {symbol: "5183.KL", type: TransactionType.BUY, quantity: 500, price: 4.2, fee: 10, date: "2025-06-12"},
    {symbol: "5225.KL", type: TransactionType.BUY, quantity: 200, price: 6.9, fee: 8, date: "2025-07-22"},
    {symbol: "4863.KL", type: TransactionType.BUY, quantity: 300, price: 6.5, fee: 9, date: "2025-10-08"},
    {symbol: "8869.KL", type: TransactionType.BUY, quantity: 400, price: 4.8, fee: 10, date: "2025-11-18"},
    {symbol: "MSFT", type: TransactionType.BUY, quantity: 8, price: 415, fee: 5, date: "2025-12-04"},
    {symbol: "NVDA", type: TransactionType.BUY, quantity: 10, price: 128, fee: 5, date: "2026-02-12"},
    {symbol: "GOOGL", type: TransactionType.BUY, quantity: 12, price: 165, fee: 5, date: "2026-03-20"},
    {symbol: "1155.KL", type: TransactionType.SELL, quantity: 80, price: 10.2, fee: 8, date: "2026-05-15"},
    {symbol: "7113.KL", type: TransactionType.BUY, quantity: 1000, price: 0.95, fee: 6, date: "2026-06-10"},
    {symbol: "1295.KL", type: TransactionType.BUY, quantity: 200, price: 4.4, fee: 7, date: "2026-07-02"},
];

async function main() {
    const user = await prisma.user.findUnique({where: {email: SEED_EMAIL}});
    if (!user) {
        throw new Error(`No user ${SEED_EMAIL}. Set SEED_EMAIL or register that account first.`);
    }

    const portfolio =
        (await prisma.portfolio.findFirst({
            where: {userId: user.id, name: "Main Portfolio"},
        })) ?? (await prisma.portfolio.findFirst({where: {userId: user.id}, orderBy: {createdAt: "asc"}}));

    if (!portfolio) {
        throw new Error(`No portfolio for ${SEED_EMAIL}`);
    }

    let inserted = 0;
    for (const trade of TRADES) {
        const date = utcDate(trade.date);
        const existing = await prisma.transaction.findFirst({
            where: {
                portfolioId: portfolio.id,
                symbol: trade.symbol,
                type: trade.type,
                date,
                quantity: trade.quantity,
                price: trade.price,
            },
        });
        if (existing) continue;

        await prisma.transaction.create({
            data: {
                portfolioId: portfolio.id,
                symbol: trade.symbol,
                type: trade.type,
                quantity: trade.quantity,
                price: trade.price,
                fee: trade.fee,
                currency: currencyFromSymbol(trade.symbol),
                date,
            },
        });
        inserted++;
    }

    await recomputePortfolioHoldings(portfolio.id);

    const symbols = [...new Set(TRADES.map((t) => t.symbol))];
    console.log(`Inserted ${inserted} trades into "${portfolio.name}". Refreshing prices for ${symbols.length} symbols…`);
    await refreshPortfolioAfterTrade(portfolio.id, symbols);
    console.log("Done. Switch to that portfolio and open Overview / Analysis / Holdings.");
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
