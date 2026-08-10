import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type AccessTokenPayload = { sub: string };
export type RefreshTokenPayload = { sub: string; jti: string };

export function signAccessToken(userId: string): string {
    const payload: AccessTokenPayload = { sub: userId };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    } as jwt.SignOptions);
  }
  
  export function signRefreshToken(userId: string, jti: string): string {
    const payload: RefreshTokenPayload = { sub: userId, jti };
    return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    } as jwt.SignOptions);
  }

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}