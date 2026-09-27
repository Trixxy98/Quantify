import {Request, Response} from "express";
import {z} from "zod";
import {getMomentumStudy} from "../services/momentum.service";
import {AppError} from "../utils/AppError";

const momentumQuerySchema = z.object({
    portfolioId: z.string().trim().min(1).optional(),
    universe: z.enum(["holdings", "basket"]).default("basket"),
    commissionBps: z.coerce.number().min(0).max(100).default(5),
    slippageBps: z.coerce.number().min(0).max(100).default(5),
    short: z.enum(["0", "1"]).default("0"),
});

export async function getMomentumHandler(req: Request, res: Response) {
    const parsed = momentumQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "universe is holdings or basket; cost bps must be between 0 and 100.");
    }
    const result = await getMomentumStudy({
        userId: req.userId!,
        portfolioId: parsed.data.portfolioId,
        universe: parsed.data.universe,
        commissionBps: parsed.data.commissionBps,
        slippageBps: parsed.data.slippageBps,
        allowShort: parsed.data.short === "1",
    });
    res.json(result);
}
