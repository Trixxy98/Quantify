import {useState, type FormEvent} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import axios from "axios";
import {createTransaction} from "../../api/portfolio.api";
import type {Currency, TransactionType} from "../../types/api.types";

type Props = {
    portfolioId: string;
};

function currencyFromSymbol(symbol: string): Currency {
    return symbol.toUpperCase().endsWith(".KL") ? "MYR" : "USD";
}

export function AddTransactionForm({portfolioId}: Props) {
    const queryClient = useQueryClient();
    const [symbol, setSymbol] = useState("");
    const [type, setType] = useState<TransactionType>("BUY");
    const [quantity, setQuantity] = useState("1");
    const [price, setPrice] = useState("");
    const [fee, setFee] = useState("0");
    const [date, setDate] = useState(() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      });
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const mutation = useMutation({
        mutationFn: () => {
            const normalizedSymbol = symbol.trim().toUpperCase();
             return createTransaction(portfolioId, {
                symbol: normalizedSymbol,
                type,
                quantity: Number(quantity),
                price: Number(price),
                currency: currencyFromSymbol(normalizedSymbol),
                fee: Number(fee) || 0,
                date,
            });
        },
        onSuccess: async () => {
            setError(null);
            setSuccess("Transaction added successfully. Press Sync to update portfolio data.");
            setSymbol("");
            setPrice("");
            await queryClient.invalidateQueries({queryKey: ["portfolio", portfolioId]});
            await queryClient.invalidateQueries({queryKey: ["portfolios"]});
        },
        onError: (err) => {
            setSuccess(null);
            if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
                setError(err.response.data.error.message);
                return;
            }
            setError("An unexpected error occurred. Please try again.");
        },
    });

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        mutation.mutate();
    }

    const inputClass = "w-full rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm";

    return (
        <form onSubmit={handleSubmit} className="rounded-xl bg-[var(--color-surface)] p-5 space-y-4">
      <h2 className="text-sm text-[var(--color-text-muted)]">Add transaction</h2>
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {success && <p className="text-sm text-[var(--color-accent)]">{success}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div>
          <label htmlFor="tx-symbol" className="block text-xs text-[var(--color-text-muted)] mb-1">
            Symbol
          </label>
          <input
            id="tx-symbol"
            required
            placeholder="1155.KL or AAPL"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-type" className="block text-xs text-[var(--color-text-muted)] mb-1">
            Type
          </label>
          <select id="tx-type" value={type} onChange={(e) => setType(e.target.value as TransactionType)} className={inputClass}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </div>
        <div>
          <label htmlFor="tx-qty" className="block text-xs text-[var(--color-text-muted)] mb-1">
            Quantity
          </label>
          <input
            id="tx-qty"
            type="number"
            min="0"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-price" className="block text-xs text-[var(--color-text-muted)] mb-1">
            Price
          </label>
          <input
            id="tx-price"
            type="number"
            min="0"
            step="any"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-fee" className="block text-xs text-[var(--color-text-muted)] mb-1">
            Fee
          </label>
          <input
            id="tx-fee"
            type="number"
            min="0"
            step="any"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-date" className="block text-xs text-[var(--color-text-muted)] mb-1">
            Date
          </label>
          <input
            id="tx-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Currency is inferred automatically: `.KL` = MYR, otherwise USD
      </p>
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