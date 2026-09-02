import {Request, Response} from "express";
import * as portfolioService from "../services/portfolio.service";
import * as dashboardService from "../services/dashboard.service";
import * as analysisService from "../services/analysis.service";
import { listTransactionsQuerySchema, rangeQuerySchema } from "../validators/portfolio.validator";

export async function listPortfoliosHandler(req: Request, res: Response) {
    const portfolios = await portfolioService.listPortfolios(req.userId!);
    res.json(portfolios);
}

export async function createPortfolioHandler(req: Request, res: Response) {
    const {name, baseCurrency} = req.body;
    const portfolio = await portfolioService.createPortfolio(req.userId!, name, baseCurrency);
    res.status(201).json(portfolio);
}

export async function getPortfolioHandler(req: Request, res: Response) {
    const portfolio = await portfolioService.getOwnedPortfolio(req.params.id, req.userId!);
    res.json(portfolio);
}

export async function updatePortfolioHandler(req: Request, res: Response) {
    const portfolio = await portfolioService.updatePortfolio(req.params.id, req.userId!, req.body);
    res.json(portfolio);
}

export async function deletePortfolioHandler(req: Request, res: Response) {
    await portfolioService.deletePortfolio(req.params.id, req.userId!);
    res.status(204).send();
}

export async function listHoldingsHandler(req: Request, res: Response) {
    const holdings = await portfolioService.listHoldings(req.params.id, req.userId!);
    res.json(holdings);  
}

export async function listClosedLotsHandler(req: Request, res: Response) {
    const result = await portfolioService.listClosedLots(req.params.id, req.userId!);
    res.json(result);
}

export async function listTransactionsHandler(req: Request, res: Response) {
    const query = listTransactionsQuerySchema.parse(req.query);
    const result = await portfolioService.listTransactions(req.params.id, req.userId!, query);
    res.json(result);
  }

  export async function createTransactionHandler(req: Request, res: Response) {
    const transaction = await portfolioService.createTransaction(req.params.id, req.userId!, req.body);
    res.status(201).json(transaction);
  }

  export async function updateTransactionHandler(req: Request, res: Response) {
    const transaction = await portfolioService.updateTransaction(
      req.params.id,
      req.params.txId,
      req.userId!,
      req.body
    );
    res.json(transaction);
  }
  
  export async function deleteTransactionHandler(req: Request, res: Response) {
    await portfolioService.deleteTransaction(req.params.id, req.params.txId, req.userId!);
    res.status(204).send();
  }
  
  export async function getSummaryHandler(req: Request, res: Response) {
    const result = await dashboardService.getSummary(req.params.id, req.userId!);
    res.json(result);
}

export async function getMetricsHandler(req: Request, res: Response) {
    const { range } = rangeQuerySchema.parse(req.query);
    const result = await dashboardService.getMetrics(req.params.id, req.userId!, range);
    res.json(result);
}

export async function getPerformanceHandler(req: Request, res: Response) {
    const { range } = rangeQuerySchema.parse(req.query);
    const result = await dashboardService.getPerformance(req.params.id, req.userId!, range);
    res.json(result);
}

export async function getAllocationHandler(req: Request, res: Response) {
    const result = await dashboardService.getAllocation(req.params.id, req.userId!);
    res.json(result);
}

export async function getAnalysisHandler(req: Request, res: Response) {
    const {range} = rangeQuerySchema.parse(req.query);
    const result = await analysisService.getAnalysis(req.params.id, req.userId!, range);
    res.json(result);
}

export async function getPriceSeriesHandler(req: Request, res: Response) {
    const {range} = rangeQuerySchema.parse(req.query);
    const result = await dashboardService.getPriceSeries(
        req.params.id,
        req.userId!,
        req.params.symbol,
        range
    );
    res.json(result);
}