import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet } from "react-router-dom";
import { logoutRequest } from "../../api/auth.api";
import { deletePortfolio } from "../../api/portfolio.api";
import { usePortfolios } from "../../hooks/usePortfolios";
import { useAuthStore } from "../../store/auth.store";
import { readSelectedPortfolioId, writeSelectedPortfolioId } from "../../utils/selectedPortfolio";
import { CreatePortfolioForm } from "../dashboard/CreatePortfolioForm";
import { RenamePortfolioForm } from "../dashboard/RenamePortfolioForm";
import { SyncButton } from "../dashboard/SyncButton";
import { TickerTape } from "./TickerTape";

export type AppShellContext = {
  portfolioId: string | undefined;
};

const NAV_ITEMS = [
  { to: "/dashboard", label: "Overview" },
  { to: "/analysis", label: "Analysis" },
  { to: "/risk", label: "Risk" },
  { to: "/factors", label: "Factors" },
  { to: "/research", label: "Research" },
  { to: "/agents", label: "Agents" },
  { to: "/chart", label: "Chart" },
  { to: "/holdings", label: "Holdings" },
  { to: "/transactions", label: "Transactions" },
  { to: "/vol", label: "Vol" },
  { to: "/events", label: "Events" },
  { to: "/data", label: "Data" },
];

// A full-width row and accent rail make the current destination easy to scan.
const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex w-full items-center rounded-lg border-l-[3px] px-3 py-2.5 text-sm transition-colors ${
    isActive
      ? "border-[var(--color-accent)] bg-[var(--color-surface)] font-semibold text-[var(--color-accent)]"
      : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
  }`;

// Matches SyncButton so every header action looks like an action, not a link.
const ghostButtonClass =
  "shrink-0 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]";

export function AppShell() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const queryClient = useQueryClient();
  const { data: portfolios, isLoading: isPortfoliosLoading, isError: isPortfoliosError } = usePortfolios();
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    readSelectedPortfolioId(useAuthStore.getState().user?.id)
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isMobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileNavOpen(false);
      } else if (event.key === "Tab") {
        const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>("a, button");
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (window.matchMedia("(max-width: 767px)").matches) menuButton?.focus();
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setIsMobileNavOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const portfolioId = resolvePortfolioId();
  const { data: tradeRefresh } = useQuery<string>({
    queryKey: ["portfolio", portfolioId, "tradeRefresh"],
    queryFn: async () => "complete",
    enabled: false,
  });

  function resolvePortfolioId() {
    if (isPortfoliosLoading) return selectedId;
    if (!portfolios || portfolios.length === 0) return undefined;
    if (selectedId && portfolios.some((p) => p.id === selectedId)) return selectedId;
    const saved = readSelectedPortfolioId(user?.id);
    return saved && portfolios.some((p) => p.id === saved) ? saved : portfolios[0].id;
  }

  useEffect(() => {
    if (isPortfoliosLoading) return;
    writeSelectedPortfolioId(user?.id, portfolioId);
  }, [portfolioId, user?.id, isPortfoliosLoading]);

  const selectedPortfolio = portfolios?.find((p) => p.id === portfolioId);

  function handleLogout() {
    const refreshToken = useAuthStore.getState().refreshToken;
    logout();
    // Revoke server-side too; the local session is already gone if this fails.
    if (refreshToken) {
      logoutRequest(refreshToken).catch(() => {});
    }
  }

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
    <div className="flex min-h-screen min-w-0">
      {isMobileNavOpen && (
        <button type="button" tabIndex={-1} aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={() => setIsMobileNavOpen(false)} />
      )}
      <aside
        ref={sidebarRef}
        id="app-navigation"
        role={isMobileNavOpen ? "dialog" : undefined}
        aria-modal={isMobileNavOpen ? true : undefined}
        aria-label={isMobileNavOpen ? "Navigation menu" : undefined}
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-[var(--color-line)] bg-[var(--color-bg)] shadow-2xl transition-transform duration-200 md:sticky md:top-0 md:z-20 md:h-dvh md:w-60 md:shrink-0 md:translate-x-0 md:shadow-none ${isMobileNavOpen ? "translate-x-0" : "invisible -translate-x-full md:visible"}`}
      >
        <div className="flex h-18 shrink-0 items-center justify-between border-b border-[var(--color-line)] px-5">
          <Link to="/dashboard" className="text-[15px] font-bold tracking-[0.12em] uppercase text-[var(--color-text)]" onClick={() => setIsMobileNavOpen(false)}>
            Quantify
          </Link>
          <button type="button" onClick={() => setIsMobileNavOpen(false)} className={ghostButtonClass + " md:hidden"} aria-label="Close navigation">✕</button>
        </div>
        <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pt-6 pb-20 md:pb-24">
          <p className="px-3 pb-2 text-xs font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase">Workspace</p>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass} onClick={() => setIsMobileNavOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-bg)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 basis-full flex-wrap items-center gap-3 sm:basis-auto sm:flex-1">
            <button ref={menuButtonRef} type="button" className={ghostButtonClass + " md:hidden"} aria-expanded={isMobileNavOpen} aria-controls="app-navigation" aria-label="Open navigation" onClick={() => setIsMobileNavOpen(true)}>
              Menu
            </button>
            <Link to="/dashboard" className="shrink-0 text-[15px] font-bold tracking-[0.12em] uppercase text-[var(--color-text)] md:hidden" onClick={() => setIsMobileNavOpen(false)}>
              Quantify
            </Link>
            {portfolios && portfolios.length > 0 && (
              <>
                <span className="hidden h-5 w-px bg-[var(--color-line)] md:block" />
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
                  className="order-3 min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] sm:order-none sm:max-w-[14rem] sm:flex-none"
                >
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div
                  className="relative order-4 sm:order-none"
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setIsManageOpen(false);
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setIsManageOpen((open) => !open)}
                    className={ghostButtonClass}
                  >
                    Manage
                  </button>
                  {isManageOpen && (
                    <div className="absolute right-0 top-full z-20 mt-2 w-40 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 text-sm shadow-xl sm:left-0 sm:right-auto">
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
          </div>
          <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-start">
            <SyncButton />
            <span className="hidden h-5 w-px bg-[var(--color-line)] md:block" />
            <span className="hidden max-w-32 truncate text-sm text-[var(--color-text-muted)] md:inline">{user?.name}</span>
            <button type="button" onClick={handleLogout} className={ghostButtonClass}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-7 px-4 pt-7 pb-28 sm:px-6 sm:pt-9 lg:px-8">
        {portfolioId && tradeRefresh && tradeRefresh !== "complete" && (
          <p role="alert" className="notice notice-error">
            A trade was saved, but analytics for this portfolio may be stale. Sync market data and check <Link to="/data" className="underline">Data</Link> before relying on figures.
          </p>
        )}
        {isPortfoliosError && (
          <p role="alert" className="notice notice-error">Could not load portfolios. Retry loading before creating one.</p>
        )}
        {!isPortfoliosLoading && !isPortfoliosError && !portfolioId && (
          <section className="space-y-3">
            <p className="notice">Start here: create a portfolio, add your first trade in Transactions, sync and check Data, then review Overview and Analysis.</p>
            <CreatePortfolioForm onCreated={setSelectedId} />
          </section>
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
          <p role="alert" className="notice notice-error">Failed to delete portfolio. Please try again.</p>
        )}
        <Outlet context={{ portfolioId } satisfies AppShellContext} />
      </main>
      </div>

      <TickerTape />
    </div>
  );
}
