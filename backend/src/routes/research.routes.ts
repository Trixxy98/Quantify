import {Router} from "express";
import {authMiddleware} from "../middleware/auth.middleware";
import {getMomentumHandler} from "../controllers/research.controller";

export const researchRouter = Router();

researchRouter.use(authMiddleware);
researchRouter.get("/momentum", getMomentumHandler);
