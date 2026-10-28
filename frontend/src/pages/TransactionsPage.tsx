import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { AddTransactionForm } from "../components/dashboard/AddTransactionForm";
import { TimingCard } from "../components/dashboard/TimingCard";
import { TransactionsTable } from "../components/dashboard/TransactionsTable";
import { useTransactions } from "../hooks/useTransactions";
import type { AppShellContext } from "../components/layout/AppShell";
import type { Transaction } from "../types/api.types";

export default function TransactionsPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editingFor, setEditingFor] = useState(portfolioId);

  if (editingFor !== portfolioId) {
    setEditingFor(portfolioId);
    setEditing(null);
  }

  const { data } = useTransactions(portfolioId, 1);

  if (!portfolioId) return null;

  return (
    <>
      <h1 className="text-2xl font-semibold">Transactions</h1>
      {data?.pagination.total === 0 && (
        <p className="notice">Record your first BUY below. Once saved, sync prices and check <Link to="/data">Data</Link> before reviewing analytics.</p>
      )}
      <AddTransactionForm
        key={editing?.id ?? "new"}
        portfolioId={portfolioId}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
      />
      <TimingCard timing={data?.timing} />
      <TransactionsTable
        key={portfolioId}
        portfolioId={portfolioId}
        editingId={editing?.id}
        onEdit={setEditing}
      />
    </>
  );
}
