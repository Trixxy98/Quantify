import { useOutletContext } from "react-router-dom";
import { AddTransactionForm } from "../components/dashboard/AddTransactionForm";
import { TransactionsTable } from "../components/dashboard/TransactionsTable";
import type { AppShellContext } from "../components/layout/AppShell";

export default function TransactionsPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();

  if (!portfolioId) return null;

  return (
    <>
      <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Transactions</h2>
      <AddTransactionForm portfolioId={portfolioId} />
      <TransactionsTable key={portfolioId} portfolioId={portfolioId} />
    </>
  );
}
