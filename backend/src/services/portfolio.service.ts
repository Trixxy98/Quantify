import {Currency, Exchange, Prisma, TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {AppError} from "../utils/AppError";

function exchangeFromSymbol(symbol: string): Exchange {
    return symbol.toUpperCase().endsWith(".KL") ? Exchange.BURSA : Exchange.US;
}

export async function getOwnedPortfolio(portfolioId: string, userId: string) {
    const portfolio = await prisma.portfolio.findUnique({where: {id: portfolioId}});
    if (!portfolio || portfolio.userId !== userId) {
        throw new AppError(404, "NOT_FOUND", "Portfolio not found");
    }
    return portfolio;
}

export function listPortfolios(userId: string) {
    return prisma.portfolio.findMany({where: {userId}, orderBy: {createdAt: "asc"}});
}

export function createPortfolio(userId: string, name: string, baseCurrency: Currency) {
    return prisma.portfolio.create({ data: {userId, name, baseCurrency}});
}

export async function updatePortfolio(
    portfolioId: string,
    userId: string,
    data: { name?: string; baseCurrency?: Currency}
) {
    await getOwnedPortfolio(portfolioId, userId);
    return prisma.portfolio.update({where: {id: portfolioId}, data});
}

export async function deletePortfolio(portfolioId: string, userId: string) {
    await getOwnedPortfolio(portfolioId, userId);
    await prisma.portfolio.delete({where: {id: portfolioId}});
}

export async function listHoldings(portfolioId: string, userId: string) {
    await getOwnedPortfolio(portfolioId, userId);
    return prisma.holding.findMany({where: {portfolioId}, orderBy: {symbol: "asc"}});
}

// Replay semua transaction untuk symbol ini (ikut tarikh) dan kira semula
// quantity + weighted average cost. Kalau baki jadi 0, holding dipadam.
async function recomputeHolding(
    tx: Prisma.TransactionClient,
    portfolioId: string,
    symbol: string,
    currency: Currency,
) {
    const transactions = await tx.transaction.findMany({
        where: {portfolioId, symbol},
        orderBy: [{date: "asc"}, {createdAt: "asc"}],
    });

    let quantity = 0;
    let totalCost = 0;

    for (const t of transactions) {
        const q = Number(t.quantity);
        const p = Number(t.price);
        const fee = Number(t.fee);

        if (t.type === TransactionType.BUY) {
            totalCost += q * p + fee;
            quantity += q;
        } else {
            if (q > quantity + 1e-9) {
                throw new AppError(
                    400,
                    "INVALID_TRANSACTION",
                    `Selling ${q} ${symbol} exceeds available quantity ${quantity}`
                );
            }
            const avgCost = totalCost / quantity;
            totalCost -= q * avgCost;
            quantity -= q;
        }
    }

    if (quantity <= 1e-9) {
        await tx.holding.deleteMany({where: {portfolioId, symbol}});
        return;
    }

    const avgCost = totalCost / quantity;
    await tx.holding.upsert({
        where: {portfolioId_symbol: {portfolioId, symbol}},
        create: {portfolioId, symbol, exchange: exchangeFromSymbol(symbol), currency, quantity, avgCost},
        update: {quantity, avgCost, currency},
    });
}

export async function createTransaction(
    portfolioId: string,
    userId: string,
    input: {
        symbol: string;
        type: TransactionType;
        quantity: number;
        price: number;
        currency: Currency;
        fee: number;
        date: Date;
    }
) {
    await getOwnedPortfolio(portfolioId, userId);

    return prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({data: {portfolioId, ...input}});
        await recomputeHolding(tx, portfolioId, input.symbol, input.currency);
        return transaction;
    });
}

export async function deleteTransaction(portfolioId: string, transactionId: string, userId: string) {
    await getOwnedPortfolio(portfolioId, userId);

    await prisma.$transaction(async (tx) => {
        const existing = await tx.transaction.findUnique({where: {id: transactionId}});
        if (!existing || existing.portfolioId !== portfolioId) {
            throw new AppError(404, "NOT_FOUND", "Transaction not found");
        }

        await tx.transaction.delete({where: {id: transactionId}});
        await recomputeHolding(tx, portfolioId, existing.symbol, existing.currency);
    });
}

export async function listTransactions(
    portfolioId: string,
    userId: string,
    opts: {symbol?: string; page: number; limit: number}
) {
    await getOwnedPortfolio(portfolioId, userId);

    const where = {portfolioId, ...(opts.symbol ? {symbol: opts.symbol.toUpperCase()} : {})};

    const [data, total] = await prisma.$transaction([
        prisma.transaction.findMany({
            where,
            orderBy: [{date: "desc"}, {createdAt: "desc"}],
            skip: (opts.page - 1) * opts.limit,
            take: opts.limit,
        }),
        prisma.transaction.count({where}),
    ]);

    return {
        data,
        pagination: {
            page: opts.page,
            limit: opts.limit,
            total,
            totalPages: Math.ceil(total / opts.limit),
        },
    };
}