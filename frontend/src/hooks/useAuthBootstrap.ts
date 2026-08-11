import {useEffect, useState} from "react";
import {apiClient} from "../api/client";
import {useAuthStore} from "../store/auth.store";

export function useAuthBootstrap(): boolean {
    const [isReady, setIsReady] = useState(false);
    const refreshToken = useAuthStore((state) => state.refreshToken);
    const setTokens = useAuthStore((state) => state.setTokens);
    const logout = useAuthStore((state) => state.logout);

    useEffect(() => {
        async function bootstrap() {
            if (!refreshToken) {
                setIsReady(true);
                return;
            }

            try {
                const {data} = await apiClient.post("/auth/refresh", {refreshToken});
                setTokens(data.accessToken, data.refreshToken);
            } catch {
                logout();
            } finally {
                setIsReady(true);
            }
        }

        bootstrap();
    }, []);

    return isReady;
}