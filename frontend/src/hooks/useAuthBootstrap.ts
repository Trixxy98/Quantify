import {useEffect, useState} from "react";
import {refreshSession} from "../api/client";
import {useAuthStore} from "../store/auth.store";

export function useAuthBootstrap(): boolean {
    const [isReady, setIsReady] = useState(false);
    const refreshToken = useAuthStore((state) => state.refreshToken);
    const logout = useAuthStore((state) => state.logout);

    useEffect(() => {
        async function bootstrap() {
            if (!refreshToken) {
                setIsReady(true);
                return;
            }

            try {
                // Shared with the 401 interceptor: StrictMode runs this effect twice, and a second
                // refresh with the same single-use token would be rejected and log the user out.
                await refreshSession(refreshToken);
            } catch {
                if (useAuthStore.getState().refreshToken === refreshToken) {
                    logout();
                }
            } finally {
                setIsReady(true);
            }
        }

        bootstrap();
    }, []);

    return isReady;
}
