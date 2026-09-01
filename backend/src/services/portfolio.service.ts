import {Currency, Exchange, Prisma, TransactionType} from "@prisma/client";
import {prisma} from "../lib/prisma";
import {AppError} from "../utils/AppError";
import {adjustTrade} from "./corporateActions";
import {refreshPortfolioAfterTradeQuietly} from "./refresh.service";
import {markOpenPositions} from "./valuation.service";

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
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const holdings = await prisma.holding.findMany({where: {portfolioId}, orderBy: {symbol: "asc"}});
    const marks = await markOpenPositions(portfolioId, portfolio.baseCurrency);
    const bySymbol = new Map(marks.map((m) => [m.symbol, m]));

    return holdings.map((holding) => {
        const mark = bySymbol.get(holding.symbol);
        return {
            ...holding,
            lastPrice: mark?.lastPrice != null ? String(mark.lastPrice) : null,
            marketValue: mark?.marketValue ?? null,
            unrealizedPnL: mark?.unrealizedPnL ?? null,
            unrealizedPnLPct: mark?.unrealizedPnLPct ?? null,
        };
    });
}

// Replay all transactions for this symbol (by date) and recompute
// quantity + weighted average cost. Delete the holding when quantity hits 0.
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
    // Queried on the same client: a split rewrites what "one share" means, so
    // holdings have to be stated on the same basis as Yahoo's prices.
    const splits = await tx.stockSplit.findMany({where: {symbol}, orderBy: {date: "asc"}});

    let quantity = 0;
    let totalCost = 0;

    for (const t of transactions) {
        const rawQty = Number(t.quantity);
        const p = Number(t.price);
        const fee = Number(t.fee);
        const {quantity: q} = adjustTrade(rawQty, p, splits, t.date.getTime());

        if (t.type === TransactionType.BUY) {
            totalCost += rawQty * p + fee;
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

export async function recomputePortfolioHoldings(portfolioId: string) {
    const symbols = await prisma.transaction.findMany({
        where: {portfolioId},
        distinct: ["symbol"],
        select: {symbol: true, currency: true},
    });

    await prisma.$transaction(async (tx) => {
        for (const row of symbols) {
            await recomputeHolding(tx, portfolioId, row.symbol, row.currency);
        }
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

    const symbol = input.symbol.toUpperCase();
    const payload = { ...input, symbol };

    const transaction = await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({data: {portfolioId, ...payload}});
        await recomputeHolding(tx, portfolioId, symbol, payload.currency);
        return created;
    });

    await refreshPortfolioAfterTradeQuietly(portfolioId, [symbol]);
    return transaction;
}

export async function updateTransaction(
    portfolioId: string,
    transactionId: string,
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

    const symbol = input.symbol.toUpperCase();

    const transaction = await prisma.$transaction(async (tx) => {
        const existing = await tx.transaction.findUnique({where: {id: transactionId}});
        if (!existing || existing.portfolioId !== portfolioId) {
            throw new AppError(404, "NOT_FOUND", "Transaction not found");
        }

        const previousSymbol = existing.symbol;
        const previousCurrency = existing.currency;

        const updated = await tx.transaction.update({
            where: {id: transactionId},
            data: {
                symbol,
                type: input.type,
                quantity: input.quantity,
                price: input.price,
                currency: input.currency,
                fee: input.fee,
                date: input.date,
            },
        });

        await recomputeHolding(
            tx,
            portfolioId,
            previousSymbol,
            previousSymbol === symbol ? input.currency : previousCurrency
        );
        if (symbol !== previousSymbol) {
            await recomputeHolding(tx, portfolioId, symbol, input.currency);
        }

        return {updated, previousSymbol};
    });

    await refreshPortfolioAfterTradeQuietly(portfolioId, [transaction.previousSymbol, symbol]);
    return transaction.updated;
}

export async function deleteTransaction(portfolioId: string, transactionId: string, userId: string) {
    await getOwnedPortfolio(portfolioId, userId);

    const symbol = await prisma.$transaction(async (tx) => {
        const existing = await tx.transaction.findUnique({where: {id: transactionId}});
        if (!existing || existing.portfolioId !== portfolioId) {
            throw new AppError(404, "NOT_FOUND", "Transaction not found");
        }

        await tx.transaction.delete({where: {id: transactionId}});
        await recomputeHolding(tx, portfolioId, existing.symbol, existing.currency);
        return existing.symbol;
    });

    await refreshPortfolioAfterTradeQuietly(portfolioId, [symbol]);
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