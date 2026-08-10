import {NextFunction, Request, Response } from "express";
import {AppError} from "../utils/AppError";
import { verifyAccessToken } from "../utils/jwt.util";

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        throw new AppError(401, "UNAUTHORIZED", "Token is required");
    }

    const token = header.slice("Bearer ".length);

    try {
        const payload = verifyAccessToken(token);
        req.userId = payload.sub;
        next();
    } catch(error) {
        throw new AppError(401, "UNAUTHORIZED", "Invalid token");
    }
}