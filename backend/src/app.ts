import "express-async-errors";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// TODO: mount routes di sini bila dah siap
// app.use("/api/auth", authRouter);
// app.use("/api/portfolios", portfolioRouter);

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route tidak wujud" } });
});

app.use(errorHandler);