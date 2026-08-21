import {Router} from "express";
import * as portfolioController from "../controllers/portfolio.controller";
import {authMiddleware} from "../middleware/auth.middleware";
import {validate} from "../middleware/validate";
import {
    createPortfolioSchema,
    createTransactionSchema,
    updatePortfolioSchema,
} from "../validators/portfolio.validator";

export const portfolioRouter = Router();

portfolioRouter.use(authMiddleware);

portfolioRouter.get("/", portfolioController.listPortfoliosHandler);
portfolioRouter.post("/", validate(createPortfolioSchema), portfolioController.createPortfolioHandler);
portfolioRouter.get("/:id", portfolioController.getPortfolioHandler);
portfolioRouter.patch("/:id", validate(updatePortfolioSchema), portfolioController.updatePortfolioHandler);
portfolioRouter.delete("/:id", portfolioController.deletePortfolioHandler);

portfolioRouter.get("/:id/holdings", portfolioController.listHoldingsHandler);
portfolioRouter.get("/:id/summary", portfolioController.getSummaryHandler);
portfolioRouter.get("/:id/metrics", portfolioController.getMetricsHandler);
portfolioRouter.get("/:id/performance", portfolioController.getPerformanceHandler);
portfolioRouter.get("/:id/allocation", portfolioController.getAllocationHandler);

portfolioRouter.get("/:id/transactions", portfolioController.listTransactionsHandler);
portfolioRouter.post(
    "/:id/transactions",
    validate(createTransactionSchema),
    portfolioController.createTransactionHandler
);
portfolioRouter.delete("/:id/transactions/:txId", portfolioController.deleteTransactionHandler);