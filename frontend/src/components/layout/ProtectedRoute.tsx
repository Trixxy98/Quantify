import {Navigate, Outlet} from "react-router-dom";
import {useAuthStore} from "../../store/auth.store";


export function ProtectedRoute() {
    const refreshToken = useAuthStore((state) => state.refreshToken);

    if (!refreshToken) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
}