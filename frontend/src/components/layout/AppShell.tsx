import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet } from "react-router-dom";
import { deletePortfolio } from "../../api/portfolio.api";
import { usePortfolios } from "../../hooks/usePortfolios";
import { useAuthStore } from "../../store/auth.store";
import { readSelectedPortfolioId, writeSelectedPortfolioId } from "../../utils/selectedPortfolio";
import { CreatePortfolioForm } from "../dashboard/CreatePortfolioForm";
import { RenamePortfolioForm } from "../dashboard/RenamePortfolioForm";
import { SyncButton } from "../dashboard/SyncButton";

export type AppShellContext = {
  portfolioId: string | undefined;
};

const navClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm ${isActive ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`;

export function AppShell() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const queryClient = useQueryClient();
  const { data: portfolios, isLoading: isPortfoliosLoading } = usePortfolios();
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    readSelectedPortfolioId(useAuthStore.getState().user?.id)
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);

  useEffect(() => {
    if (isPortfoliosLoading) return;
    if (!portfolios || portfolios.length === 0) {
      setSelectedId(undefined);
      return;
    }
    const stillExists = selectedId && portfolios.some((p) => p.id === selectedId);
    if (stillExists) return;

    const saved = readSelectedPortfolioId(user?.id);
    const savedExists = saved && portfolios.some((p) => p.id === saved);
    setSelectedId(savedExists ? saved : portfolios[0].id);
  }, [portfolios, selectedId, user?.id, isPortfoliosLoading]);

  useEffect(() => {
    if (isPortfoliosLoading) return;
    writeSelectedPortfolioId(user?.id, selectedId);
  }, [selectedId, user?.id, isPortfoliosLoading]);

  const portfolioId = selectedId;
  const selectedPortfolio = portfolios?.find((p) => p.id === portfolioId);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: async (_result, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio", deletedId] });
      setIsRenaming(false);
      setIsCreating(false);
    },
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link to="/dashboard" className="shrink-0 text-sm font-semibold tracking-wide">
              Quantify
            </Link>
            {portfolios && portfolios.length > 0 && (
              <>
                <span className="hidden h-4 w-px bg-slate-700 sm:block" />
                <label htmlFor="portfolio-select" className="sr-only">
                  Portfolio
                </label>
                <select
                  id="portfolio-select"
                  value={portfolioId ?? ""}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setIsRenaming(false);
                    setIsCreating(false);
                    setIsManageOpen(false);
                  }}
                  className="max-w-[14rem] truncate bg-transparent py-1 text-sm font-medium outline-none"
                >
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div
                  className="relative"
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setIsManageOpen(false);
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setIsManageOpen((open) => !open)}
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    Manage
                  </button>
                  {isManageOpen && (
                    <div className="absolute left-0 top-full z-20 mt-2 w-40 rounded-md border border-slate-700 bg-[var(--color-surface)] py-1 text-sm shadow-lg">
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left hover:bg-slate-800/80"
                        onClick={() => {
                          setIsCreating((open) => !open);
                          setIsRenaming(false);
                          setIsManageOpen(false);
                        }}
                      >
                        {isCreating ? "Cancel create" : "Create"}
                      </button>
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left hover:bg-slate-800/80"
                        onClick={() => {
                          setIsRenaming((open) => !open);
                          setIsCreating(false);
                          setIsManageOpen(false);
                        }}
                      >
                        {isRenaming ? "Cancel rename" : "Rename"}
                      </button>
                      <button
                        type="button"
                        disabled={!portfolioId || deleteMutation.isPending}
                        className="block w-full px-3 py-1.5 text-left text-[var(--color-danger)] hover:bg-slate-800/80 disabled:opacity-50"
                        onClick={() => {
                          const name = selectedPortfolio?.name ?? "this portfolio";
                          setIsManageOpen(false);
                          if (
                            window.confirm(
                              `Delete "${name}"? Holdings, transactions, and snapshots will be removed.`
                            )
                          ) {
                            deleteMutation.mutate(portfolioId!);
                          }
                        }}
                      >
                        {deleteMutation.isPending ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
            <nav className="ml-2 hidden items-center gap-4 sm:flex">
              <NavLink to="/dashboard" className={navClass}>
                Overview
              </NavLink>
              <NavLink to="/analysis" className={navClass}>
                Analysis
              </NavLink>
              <NavLink to="/holdings" className={navClass}>
                Holdings
              </NavLink>
              <NavLink to="/transactions" className={navClass}>
                Transactions
              </NavLink>
              <NavLink to="/vol" className={navClass}>
                Vol
              </NavLink>
              <NavLink to="/events" className={navClass}>
                Events
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <SyncButton />
            <span className="hidden text-sm text-[var(--color-text-muted)] sm:inline">{user?.name}</span>
            <button
              type="button"
              onClick={logout}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Log out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-4 px-6 pb-3 sm:hidden">
          <NavLink to="/dashboard" className={navClass}>
            Overview
          </NavLink>
          <NavLink to="/analysis" className={navClass}>
            Analysis
          </NavLink>
          <NavLink to="/holdings" className={navClass}>
            Holdings
          </NavLink>
          <NavLink to="/transactions" className={navClass}>
            Transactions
          </NavLink>
          <NavLink to="/vol" className={navClass}>
            Vol
          </NavLink>
          <NavLink to="/events" className={navClass}>
            Events
          </NavLink>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-8">
        {!isPortfoliosLoading && !portfolioId && (
          <CreatePortfolioForm onCreated={setSelectedId} />
        )}
        {portfolioId && isCreating && (
          <CreatePortfolioForm
            onCreated={(id) => {
              setSelectedId(id);
              setIsCreating(false);
            }}
          />
        )}
        {portfolioId && isRenaming && selectedPortfolio && (
          <RenamePortfolioForm
            key={portfolioId}
            portfolioId={portfolioId}
            currentName={selectedPortfolio.name}
            onDone={() => setIsRenaming(false)}
          />
        )}
        {deleteMutation.isError && (
          <p className="text-sm text-[var(--color-danger)]">Failed to delete portfolio. Please try again.</p>
        )}
        <Outlet context={{ portfolioId } satisfies AppShellContext} />
      </main>
    </div>
  );
}
