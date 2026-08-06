import {PrismaClient} from "@prisma/client";
import {env} from "../config/env";

declare global {
    var prismaGlobal: PrismaClient | undefined;
}

export const prisma = globalThis.prismaGlobal ?? new PrismaClient();

if (env.NODE_ENV !== "production") {
    globalThis.prismaGlobal = prisma;
}