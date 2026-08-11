import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type User = {id: string; email: string; name: string};

type AuthState = {
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
    setAuth: (user: User, accessToken: string, refreshToken: string) => void;
    setTokens: (accessToken: string, refreshToken: string) => void;
    logout: () => void;
};

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            accessToken: null,
            refreshToken: null,
            setAuth: (user, accessToken, refreshToken) => set({user, accessToken, refreshToken}),
            setTokens: (accessToken, refreshToken) => set({accessToken, refreshToken}),
            logout: () => set({user: null, accessToken: null, refreshToken: null}),
        }),
        {
            name: "quantify-auth",
            partialize: (state) => ({refreshToken: state.refreshToken, user: state.user}),
        }
    )
);