import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { createPortfolio } from "../../api/portfolio.api";
import type { Currency } from "../../types/api.types";

type Props = {
  onCreated?: (portfolioId: string) => void;
};

export function CreatePortfolioForm({ onCreated }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Main Portfolio");
  const [baseCurrency, setBaseCurrency] = useState<Currency>("MYR");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createPortfolio(name.trim(), baseCurrency),
    onSuccess: async (portfolio) => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      onCreated?.(portfolio.id);
    },
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        setError(err.response.data.error.message);
        return;
      }
      setError("Failed to create portfolio. Please try again.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    mutation.mutate();
  }

  const inputClass = "w-full rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm";

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-[var(--color-surface)] p-5 space-y-4 max-w-md">
      <h2 className="text-sm text-[var(--color-text-muted)]">Create portfolio</h2>
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div>
        <label htmlFor="pf-name" className="block text-xs text-[var(--color-text-muted)] mb-1">
          Name
        </label>
        <input
          id="pf-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="pf-currency" className="block text-xs text-[var(--color-text-muted)] mb-1">
          Base currency
        </label>
        <select
          id="pf-currency"
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value as Currency)}
          className={inputClass}
        >
          <option value="MYR">MYR</option>
          <option value="USD">USD</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
      >
        {mutation.isPending ? "Creating..." : "Create"}
      </button>
    </form>
  );
}