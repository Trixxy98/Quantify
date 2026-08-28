import {useEffect, useState, type FormEvent} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import axios from "axios";
import {createTransaction, updateTransaction} from "../../api/portfolio.api";
import {useHoldings} from "../../hooks/useHoldings";
import {useMarketClose} from "../../hooks/useMarketClose";
import {SymbolSearchField} from "./SymbolSearchField";
import type {Currency, Transaction, TransactionType} from "../../types/api.types";

type Props = {
    portfolioId: string;
    editing?: Transaction | null;
    onCancelEdit?: () => void;
};

function currencyFromSymbol(symbol: string): Currency {
    return symbol.toUpperCase().endsWith(".KL") ? "MYR" : "USD";
}

function decimalInput(value: string) {
    return String(Number(value));
}

export function AddTransactionForm({portfolioId, editing = null, onCancelEdit}: Props) {
    const queryClient = useQueryClient();
    const {data: holdings} = useHoldings(portfolioId);
    const [symbol, setSymbol] = useState(editing?.symbol ?? "");
    const [type, setType] = useState<TransactionType>(editing?.type ?? "BUY");
    const [quantity, setQuantity] = useState(editing ? decimalInput(editing.quantity) : "1");
    const [price, setPrice] = useState(editing ? decimalInput(editing.price) : "");
    const [priceTouched, setPriceTouched] = useState(Boolean(editing));
    const [fee, setFee] = useState(editing ? decimalInput(editing.fee) : "0");
    const [date, setDate] = useState(() => {
        if (editing) return editing.date.slice(0, 10);
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      });
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const {data: close, isFetching: isCloseLoading, isError: isCloseError, isFetched: isCloseFetched} = useMarketClose(symbol, date);

    useEffect(() => {
        if (priceTouched || close == null) return;
        setPrice(String(close.close));
    }, [close, priceTouched]);

    const mutation = useMutation({
        mutationFn: () => {
            const normalizedSymbol = symbol.trim().toUpperCase();
            const payload = {
                symbol: normalizedSymbol,
                type,
                quantity: Number(quantity),
                price: Number(price),
                currency: currencyFromSymbol(normalizedSymbol),
                fee: Number(fee) || 0,
                date,
            };
            if (editing) {
                return updateTransaction(portfolioId, editing.id, payload);
            }
            return createTransaction(portfolioId, payload);
        },
        onSuccess: async () => {
            setError(null);
            setSuccess(editing
                ? "Transaction updated. Holdings and charts were refreshed."
                : "Transaction saved. Holdings and charts were refreshed.");
            if (!editing) {
                setSymbol("");
                setPrice("");
                setPriceTouched(false);
            }
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
      <h2 className="text-sm text-[var(--color-text-muted)]">
        {editing ? `Edit ${type} ${symbol || editing.symbol}` : "Add transaction"}
      </h2>
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {success && <p className="text-sm text-[var(--color-accent)]">{success}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="sm:col-span-2">
          <label htmlFor="tx-symbol" className="block text-xs text-[var(--color-text-muted)] mb-1">
            Symbol
          </label>
          <SymbolSearchField
            id="tx-symbol"
            value={symbol}
            onChange={(next) => {
              setSymbol(next);
              setPriceTouched(false);
            }}
            className={inputClass}
            holdings={holdings}
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
            onChange={(e) => {
              setPriceTouched(true);
              setPrice(e.target.value);
            }}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {isCloseLoading && "Loading close price..."}
            {!isCloseLoading && close && (
              priceTouched
                ? <>Market close on {close.date}: {close.close}{close.date !== date ? " (prior session)" : ""}</>
                : <>Filled from close on {close.date}{close.date !== date ? " (prior session)" : ""}</>
            )}
            {!isCloseLoading && !close && isCloseFetched && (isCloseError
              ? "Could not load price — enter it manually"
              : "No close for this date — enter it manually")}
          </p>
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
            onChange={(e) => {
              setDate(e.target.value);
              setPriceTouched(false);
            }}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Click the symbol field to pick a ticker. Quantity and fee are yours to enter. Price fills from the market close on that date (you can still edit it). `.KL` = MYR, otherwise USD
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
        >
          {mutation.isPending ? "Updating portfolio..." : editing ? "Update" : "Save"}
        </button>
        {editing && (
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={onCancelEdit}
            className="text-sm text-[var(--color-text-muted)] disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
    );
}
