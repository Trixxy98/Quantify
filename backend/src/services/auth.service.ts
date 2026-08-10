import crypto from "crypto";
import {env} from "../config/env";
import {prisma} from "../lib/prisma";
import {AppError} from "../utils/AppError";
import {comparePassword, hashPassword, hashToken} from "../utils/hash.util";
import {signAccessToken, signRefreshToken, verifyRefreshToken} from "../utils/jwt.util";

function refreshExpiryDate(): Date {
    const days = parseInt(env.JWT_REFRESH_EXPIRES_IN, 10) || 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function issueTokenPair(userId: string) {
    const jti = crypto.randomUUID();
    const accessToken = signAccessToken(userId);
    const refreshToken = signRefreshToken(userId, jti);

    await prisma.refreshToken.create({
        data: {
            userId,
            tokenHash: hashToken(refreshToken),
            expiresAt: refreshExpiryDate(),
        },
    });

    return {accessToken, refreshToken};
}

export async function register(email: string, password: string, name: string) {
    const existing = await prisma.user.findUnique({where: {email}});
    if (existing) {
        throw new AppError(409, "EMAIL_TOKEN", "Email already in use");
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
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token tidak sah atau tamat tempoh");
    }
    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token tidak sah atau tamat tempoh");
    }
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return issueTokenPair(payload.sub);
  }
  export async function logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }