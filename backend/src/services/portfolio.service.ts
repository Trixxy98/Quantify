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

function toBaseCurrency(
    amount: number,
    from: Currency,
    base: Currency,
    usdMyr: number | null
): number | null {
    if (from === base) return amount;
    if (usdMyr == null) return null;
    return from === Currency.USD ? amount * usdMyr : amount / usdMyr;
}

export async function listHoldings(portfolioId: string, userId: string) {
    const portfolio = await getOwnedPortfolio(portfolioId, userId);
    const holdings = await prisma.holding.findMany({where: {portfolioId}, orderBy: {symbol: "asc"}});

    const latestFx = await prisma.exchangeRate.findFirst({
        where: {from: Currency.USD, to: Currency.MYR},
        orderBy: {date: "desc"},
    });
    const usdMyr = latestFx ? Number(latestFx.rate) : null;

    const rows = [];
    for (const holding of holdings) {
        const lastPrice = await prisma.dailyPrice.findFirst({
            where: {symbol: holding.symbol},
            orderBy: {date: "desc"},
        });

        let marketValue: number | null = null;
        let unrealizedPnL: number | null = null;
        let unrealizedPnLPct: number | null = null;

        if (lastPrice) {
            const quantity = Number(holding.quantity);
            const avgCost = Number(holding.avgCost);
            const close = Number(lastPrice.close);
            const nativeValue = quantity * close;
            const nativeCost = quantity * avgCost;
            marketValue = toBaseCurrency(nativeValue, holding.currency, portfolio.baseCurrency, usdMyr);
            const costBasis = toBaseCurrency(nativeCost, holding.currency, portfolio.baseCurrency, usdMyr);
            if (marketValue != null && costBasis != null) {
                unrealizedPnL = marketValue - costBasis;
                unrealizedPnLPct = costBasis > 0 ? unrealizedPnL / costBasis : 0;
            }
        }

        rows.push({
            ...holding,
            lastPrice: lastPrice ? lastPrice.close.toString() : null,
            marketValue,
            unrealizedPnL,
            unrealizedPnLPct,
        });
    }

    return rows;
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

    const symbol = input.symbol.toUpperCase();
    const payload = { ...input, symbol };

    return prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({data: {portfolioId, ...payload}});
        await recomputeHolding(tx, portfolioId, symbol, payload.currency);
        return transaction;
    });
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

    return prisma.$transaction(async (tx) => {
        const existing = await tx.transaction.findUnique({where: {id: transactionId}});
        if (!existing || existing.portfolioId !== portfolioId) {
            throw new AppError(404, "NOT_FOUND", "Transaction not found");
        }

        const previousSymbol = existing.symbol;
        const previousCurrency = existing.currency;

        const transaction = await tx.transaction.update({
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