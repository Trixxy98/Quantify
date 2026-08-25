import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerRequest } from "../api/auth.api";
import { useAuthStore } from "../store/auth.store";
import axios from "axios";

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const { user, accessToken, refreshToken } = await registerRequest(email, password, name);
      setAuth(user, accessToken, refreshToken);
      navigate("/dashboard");
    } catch (err) {
      const isTaken = axios.isAxiosError(err) && err.response?.status === 409;
      setError(isTaken ? "Email ini sudah didaftarkan" : "Pendaftaran gagal. Cuba lagi.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-[var(--color-surface)] p-8 rounded-xl space-y-4">
        <h1 className="text-xl font-semibold text-center">Daftar Akaun Quantify</h1>

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        <div>
          <label htmlFor="name" className="block text-sm text-[var(--color-text-muted)] mb-1">Nama</label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm text-[var(--color-text-muted)] mb-1">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-[var(--color-text-muted)] mb-1">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
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
          {isLoading ? "Mendaftar..." : "Daftar"}
        </button>

        <p className="text-sm text-center text-[var(--color-text-muted)]">
          Dah ada akaun? <Link to="/login" className="text-[var(--color-accent)]">Log Masuk</Link>
        </p>
      </form>
    </div>
  );
}