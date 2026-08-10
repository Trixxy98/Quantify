import {NextFunction, Request, Response} from "express";
import {ZodSchema} from "zod";

export function validate(schema: ZodSchema) {
    return (req: Request, _res: Response, next: NextFunction) => {
        req.body = schema.parse(req.body);
        next();
    };
}