import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { updatePortfolio } from "../../api/portfolio.api";

type Props = {
  portfolioId: string;
  currentName: string;
  onDone?: () => void;
};

export function RenamePortfolioForm({ portfolioId, currentName, onDone }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => updatePortfolio(portfolioId, { name: name.trim() }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
      onDone?.();
    },
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        setError(err.response.data.error.message);
        return;
      }
      setError("Failed to rename portfolio. Please try again.");
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
      <h2 className="text-sm text-[var(--color-text-muted)]">Rename portfolio</h2>
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div>
        <label htmlFor="rename-pf-name" className="block text-xs text-[var(--color-text-muted)] mb-1">
          Name
        </label>
        <input
          id="rename-pf-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
      >
        {mutation.isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
