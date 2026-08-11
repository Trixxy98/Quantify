import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginRequest } from "../api/auth.api";
import { useAuthStore } from "../store/auth.store";

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const { user, accessToken, refreshToken } = await loginRequest(email, password);
      setAuth(user, accessToken, refreshToken);
      navigate("/dashboard");
    } catch {
      setError("Email atau password salah");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-[var(--color-surface)] p-8 rounded-xl space-y-4">
        <h1 className="text-xl font-semibold text-center">Log Masuk Quantify</h1>

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        <div>
          <label className="block text-sm text-[var(--color-text-muted)] mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-text-muted)] mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-md bg-[var(--color-accent)] py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
        >
          {isLoading ? "Log masuk..." : "Log Masuk"}
        </button>

        <p className="text-sm text-center text-[var(--color-text-muted)]">
          Tiada akaun? <Link to="/register" className="text-[var(--color-accent)]">Daftar</Link>
        </p>
      </form>
    </div>
  );
}