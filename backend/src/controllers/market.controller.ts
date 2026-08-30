import {Request, Response} from "express";
import {z} from "zod";
import {AppError} from "../utils/AppError";
import {getCloseOnOrBefore, getQuotes, searchSymbols} from "../services/market.service";
import {buildIvSurface} from "../services/ivSurface.service";

const searchQuerySchema = z.object({
    q: z.string().trim().min(1).max(80),
});

export async function searchSymbolsHandler(req: Request, res: Response) {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Query q is required");
    }

    try {
        const results = await searchSymbols(parsed.data.q);
        res.json(results);
    } catch (err) {
        console.error("[search] Yahoo search failed", err);
        throw new AppError(502, "SEARCH_FAILED", "Symbol search is unavailable. Type the ticker instead.");
    }
}

const closeQuerySchema = z.object({
    symbol: z.string().trim().min(1).max(20),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export async function getCloseHandler(req: Request, res: Response) {
    const parsed = closeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "symbol and date (YYYY-MM-DD) are required");
    }

    try {
        const result = await getCloseOnOrBefore(
            parsed.data.symbol,
            new Date(`${parsed.data.date}T00:00:00.000Z`)
        );
        res.json(result);
    } catch (err) {
        console.error("[close] Failed to load market close", err);
        throw new AppError(502, "PRICE_UNAVAILABLE", "Could not load the market price. Enter it manually.");
    }
}

const MAX_TICKER_SYMBOLS = 25;

const quotesQuerySchema = z.object({
    symbols: z.string().trim().min(1).max(400),
});

export async function getQuotesHandler(req: Request, res: Response) {
    const parsed = quotesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "symbols is required");
    }

    const symbols = parsed.data.symbols
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

    if (symbols.length === 0 || symbols.length > MAX_TICKER_SYMBOLS) {
        throw new AppError(400, "VALIDATION_ERROR", `Pass between 1 and ${MAX_TICKER_SYMBOLS} symbols.`);
    }
    // Indices (^KLSE) and FX pairs (MYR=X) are valid here, unlike the holdings endpoints
    if (symbols.some((symbol) => !/^[A-Z0-9^=.-]{1,15}$/.test(symbol))) {
        throw new AppError(400, "VALIDATION_ERROR", "One of the symbols is not a valid ticker.");
    }

    try {
        const quotes = await getQuotes(symbols);
        res.json(quotes);
    } catch (err) {
        console.error("[quotes] Yahoo quote failed", err);
        throw new AppError(502, "QUOTES_UNAVAILABLE", "Live quotes are unavailable right now.");
    }
}

const ivQuerySchema = z.object({
    symbol: z.string().trim().min(1).max(20),
});

export async function getIvSurfaceHandler(req: Request, res: Response) {
    const parsed = ivQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "symbol is required");
    }

    const result = await buildIvSurface(parsed.data.symbol);
    res.json(result);
}
