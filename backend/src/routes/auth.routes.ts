import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { validate } from "../middleware/validate";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "../validators/auth.validator";

export const authRouter = Router();

authRouter.post("/register", validate(registerSchema), authController.registerHandler);
authRouter.post("/login", validate(loginSchema), authController.loginHandler);
authRouter.post("/refresh", validate(refreshSchema), authController.refreshHandler);
authRouter.post("/logout", validate(logoutSchema), authController.logoutHandler);