import {Router} from "express";
import {authMiddleware} from "../middleware/auth.middleware";
import {getCloseHandler, searchSymbolsHandler} from "../controllers/market.controller";

export const marketRouter = Router();

marketRouter.use(authMiddleware);
marketRouter.get("/search", searchSymbolsHandler);
marketRouter.get("/close", getCloseHandler);
