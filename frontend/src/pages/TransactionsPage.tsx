import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AddTransactionForm } from "../components/dashboard/AddTransactionForm";
import { TransactionsTable } from "../components/dashboard/TransactionsTable";
import type { AppShellContext } from "../components/layout/AppShell";
import type { Transaction } from "../types/api.types";

export default function TransactionsPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();
  const [editing, setEditing] = useState<Transaction | null>(null);

  useEffect(() => {
    setEditing(null);
  }, [portfolioId]);

  if (!portfolioId) return null;

  return (
    <>
      <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Transactions</h2>
      <AddTransactionForm
        key={editing?.id ?? "new"}
        portfolioId={portfolioId}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
      />
      <TransactionsTable
        key={portfolioId}
        portfolioId={portfolioId}
        editingId={editing?.id}
        onEdit={setEditing}
      />
    </>
  );
}
