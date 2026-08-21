import dotenv from "dotenv";
import {z} from "zod";

dotenv.config();

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET mesti sekurang-kurangnya 32 aksara"),
    JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET mesti sekurang-kurangnya 32 aksara"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
    });
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
    console.error("Environment variables tidak sah:", parsed.error.flatten().fieldErrors);
    process.exit(1);
    }
    export const env = parsed.data;
