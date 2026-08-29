import {Router} from "express";
import {authMiddleware} from "../middleware/auth.middleware";
import {getCloseHandler, getIvSurfaceHandler, searchSymbolsHandler} from "../controllers/market.controller";

export const marketRouter = Router();

marketRouter.use(authMiddleware);
marketRouter.get("/search", searchSymbolsHandler);
marketRouter.get("/close", getCloseHandler);
marketRouter.get("/iv-surface", getIvSurfaceHandler);
