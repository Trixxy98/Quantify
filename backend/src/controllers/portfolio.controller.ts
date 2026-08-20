import {Request, Response} from "express";
import * as portfolioService from "../services/portfolio.service";
import {listTransactionsQuerySchema} from "../validators/portfolio.validator";

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

export async function listTransactionsHandler(req: Request, res: Response) {
    const query = listTransactionsQuerySchema.parse(req.query);
    const result = await portfolioService.listTransactions(req.params.id, req.userId!, query);
    res.json(result);
  }

  export async function createTransactionHandler(req: Request, res: Response) {
    const transaction = await portfolioService.createTransaction(req.params.id, req.userId!, req.body);
    res.status(201).json(transaction);
  }
  
  export async function deleteTransactionHandler(req: Request, res: Response) {
    await portfolioService.deleteTransaction(req.params.id, req.params.txId, req.userId!);
    res.status(204).send();
  }
  