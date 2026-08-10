import crypto from "crypto";
import {env} from "../config/env";
import {prisma} from "../lib/prisma";
import {AppError} from "../utils/AppError";
import {comparePassword, hashPassword, hashToken} from "../utils/hash.util";
import {signAccessToken, signRefreshToken, verifyRefreshToken} from "../utils/jwt.util";
import jwt from "jsonwebtoken";

function refreshExpiryDate(): Date {
    const days = parseInt(env.JWT_REFRESH_EXPIRES_IN, 10) || 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function issueTokenPair(userId: string) {
    const jti = crypto.randomUUID();
    const accessToken = signAccessToken(userId);
    const refreshToken = signRefreshToken(userId, jti);

    const decoded = jwt.decode(refreshToken) as {exp: number};
    const expiresAt = new Date(decoded.exp * 1000);

    await prisma.refreshToken.create({
        data: {
            userId,
            tokenHash: hashToken(refreshToken),
            expiresAt
        },
    });

    return {accessToken, refreshToken};
}

export async function register(email: string, password: string, name: string) {
    const existing = await prisma.user.findUnique({where: {email}});
    if (existing) {
        throw new AppError(409, "EMAIL_TAKEN", "Email already in use");
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({data: {email, passwordHash, name}});

    const tokens = await issueTokenPair(user.id);
    return {user: {id: user.id, email: user.email, name: user.name}, ...tokens};
}

export async function login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email atau password salah");
    }
    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email atau password salah");
    }
    const tokens = await issueTokenPair(user.id);
    return { user: { id: user.id, email: user.email, name: user.name }, ...tokens };
  }
  export async function refresh(refreshToken: string) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
    }
  
    const tokenHash = hashToken(refreshToken);
    const now = new Date();
    const { count } = await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
  
    if (count !== 1) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
    }
  
    return issueTokenPair(payload.sub);
  }
  export async function logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }