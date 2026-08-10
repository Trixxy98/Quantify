import {Request, Response} from "express";
import * as authService from "../services/auth.service";

export async function registerHandler(req: Request, res: Response) {
    const {email, password, name} = req.body;
    const result = await authService.register(email, password, name);
    res.status(201).json(result);
}

export async function loginHandler(req: Request, res: Response) {
    const {email, password} = req.body;
    const result = await authService.login(email, password);
    res.status(200).json(result);
}

export async function refreshHandler(req: Request, res: Response) {
    const {refreshToken} = req.body;
    const result = await authService.refresh(refreshToken);
    res.status(200).json(result);
}

export async function logoutHandler(req: Request, res: Response) {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);
    res.status(204).send();
  }