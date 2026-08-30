import {Request, Response} from "express";
import {z} from "zod";
import {AppError} from "../utils/AppError";
import {runEventStudy} from "../services/eventStudy.service";

const MAX_SYMBOLS = 8;

const studyQuerySchema = z.object({
    symbols: z.string().trim().min(1).max(120),
    type: z.enum(["FOMC", "CPI", "EARNINGS"]),
    pre: z.coerce.number().int().min(1).max(20).default(5),
    post: z.coerce.number().int().min(1).max(30).default(10),
    years: z.coerce.number().int().min(2).max(6).default(5),
    hold: z.coerce.number().int().min(1).max(20).default(3),
});

export async function getEventStudyHandler(req: Request, res: Response) {
    const parsed = studyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        throw new AppError(
            400,
            "VALIDATION_ERROR",
            "symbols and type (FOMC, CPI, EARNINGS) are required; pre/post/years/hold must be in range"
        );
    }

    const symbols = parsed.data.symbols
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

    if (symbols.length === 0 || symbols.length > MAX_SYMBOLS) {
        throw new AppError(400, "VALIDATION_ERROR", `Pass between 1 and ${MAX_SYMBOLS} symbols.`);
    }
    if (symbols.some((symbol) => !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(symbol))) {
        throw new AppError(400, "VALIDATION_ERROR", "One of the symbols is not a valid ticker.");
    }

    const result = await runEventStudy({...parsed.data, symbols});
    res.json(result);
}
