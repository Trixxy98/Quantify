import {apiClient} from "./client";
import type {User} from "../store/auth.store";

export type AuthResponse = {user: User; accessToken: string; refreshToken: string};

export async function registerRequest(email: string, password: string, name: string): Promise<AuthResponse> {
    const {data} = await apiClient.post<AuthResponse>("/auth/register", {email, password, name});
    return data;
}

export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
    const {data} = await apiClient.post<AuthResponse>("/auth/login", {email, password});
    return data;
}

export async function logoutRequest(refreshToken: string): Promise<void> {
    await apiClient.post("/auth/logout", { refreshToken });
  }
  