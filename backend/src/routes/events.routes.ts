import {Router} from "express";
import {authMiddleware} from "../middleware/auth.middleware";
import {getEventStudyHandler, getVariancePremiumHandler} from "../controllers/events.controller";

export const eventsRouter = Router();

eventsRouter.use(authMiddleware);
eventsRouter.get("/study", getEventStudyHandler);
eventsRouter.get("/premium", getVariancePremiumHandler);
