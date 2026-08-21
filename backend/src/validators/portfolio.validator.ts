import {z} from "zod";

export const createPortfolioSchema = z.object({
    name: z.string().min(1, "Name is required"),
    baseCurrency: z.enum(["MYR", "USD"]).default("MYR"),
});

export const updatePortfolioSchema = z
    .object({
        name: z.string().min(1).optional(),
        basicCurrency: z.enum(["MYR", "USD"]).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field is required",
    });

export const createTransactionSchema = z.object({
    symbol: z.string().min(1, "Symbol is required").transform((s) => s.toUpperCase()),
    type: z.enum(["BUY", "SELL"]),
    quantity: z.coerce.number().positive("Quantity must be greater than 0"),
    price: z.coerce.number().positive("Price must be greater than 0"),
    currency: z.enum(["MYR", "USD"]),
    fee: z.coerce.number().min(0).default(0),
    date: z.coerce.date(),
});

export const listTransactionsQuerySchema = z.object({
    symbol: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const rangeQuerySchema = z.object({
    range: z.enum(["1M", "3M", "6M", "1Y", "YTD", "ALL"]).default("1Y"),
});