import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteTransaction } from "../../api/portfolio.api";
import { useTransactions } from "../../hooks/useTransactions";
import { formatMoney } from "../../utils/format";

type Props = {
  portfolioId: string;
};

export function TransactionsTable({ portfolioId }: Props) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useTransactions(portfolioId, page);

  const mutation = useMutation({
    mutationFn: (transactionId: string) => deleteTransaction(portfolioId, transactionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["portfolio", portfolioId] });
    },
  });

  if (isLoading) {
    return <div className="h-40 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  const rows = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Transactions</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No transactions yet</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium">Symbol</th>
              <th className="pb-2 font-medium text-right">Qty</th>
              <th className="pb-2 font-medium text-right">Price</th>
              <th className="pb-2 font-medium text-right">Fee</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => (
              <tr key={tx.id} className="border-t border-slate-700">
                <td className="py-2">{tx.date.slice(0, 10)}</td>
                <td className={`py-2 ${tx.type === "BUY" ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}>
                  {tx.type}
                </td>
                <td className="py-2 font-medium">{tx.symbol}</td>
                <td className="py-2 text-right">{Number(tx.quantity).toLocaleString()}</td>
                <td className="py-2 text-right">{formatMoney(Number(tx.price), tx.currency)}</td>
                <td className="py-2 text-right">{formatMoney(Number(tx.fee), tx.currency)}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete ${tx.type} ${tx.symbol}? Holdings will be recalculated.`)) {
                        mutation.mutate(tx.id);
                      }
                    }}
                    className="text-xs text-[var(--color-danger)] disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center gap-3 mt-4 text-sm text-[var(--color-text-muted)]">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="disabled:opacity-50"
          >
            Prev
          </button>
          <span>
            {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}