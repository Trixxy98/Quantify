import {Router} from "express";
import {runFullSync} from "../jobs/sync.job";
import {authMiddleware} from "../middleware/auth.middleware";

export const syncRouter = Router();

syncRouter.use(authMiddleware);

syncRouter.post("/", async (_req, res) => {
    const result = await runFullSync();
    res.json({status: "ok", ...result});
})