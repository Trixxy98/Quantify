import axios, {type AxiosError, type InternalAxiosRequestConfig} from 'axios';
import { useAuthStore } from '../store/auth.store';

export const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
});

apiClient.interceptors.request.use((config) => {
    const accessToken = useAuthStore.getState().accessToken;
    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(sessionToken: string): Promise<string> {
    const { data } = await axios.post(`${apiClient.defaults.baseURL}/auth/refresh`, {
      refreshToken: sessionToken,
    });
  
    if (useAuthStore.getState().refreshToken !== sessionToken) {
      throw new Error("Session changed during refresh");
    }
  
    useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
}

apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
  
      const isRefreshCall = originalRequest.url?.includes("/auth/refresh");
      if (error.response?.status !== 401 || originalRequest._retry || isRefreshCall) {
        return Promise.reject(error);
      }
  
      originalRequest._retry = true;
      const sessionToken = useAuthStore.getState().refreshToken;
  
      if (!sessionToken) {
        return Promise.reject(error);
      }
  
      try {
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken(sessionToken).finally(() => {
            refreshPromise = null;
          });
        }
        const newAccessToken = await refreshPromise;
  
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        if (useAuthStore.getState().refreshToken === sessionToken) {
          useAuthStore.getState().logout();
        }
        return Promise.reject(refreshError);
      }
    }
  );