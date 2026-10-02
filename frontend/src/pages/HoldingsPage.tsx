import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { HoldingsTable } from "../components/dashboard/HoldingsTable";
import { ClosedLotsTable } from "../components/dashboard/ClosedLotsTable";
import { PriceChart } from "../components/dashboard/PriceChart";
import { RangeChips } from "../components/dashboard/RangeChips";
import type { AppShellContext } from "../components/layout/AppShell";
import { useClosedLots } from "../hooks/useClosedLots";
import { useHoldingPrices } from "../hooks/useHoldingPrices";
import { useHoldings } from "../hooks/useHoldings";
import { usePortfolioAllocation } from "../hooks/usePortfolioAllocation";
import { usePortfolioSummary } from "../hooks/usePortfolioSummary";
import type { Range } from "../types/api.types";

export default function HoldingsPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();
  const [range, setRange] = useState<Range>("1Y");
  const [pickedSymbol, setPickedSymbol] = useState<string | undefined>();

  const { data: summary } = usePortfolioSummary(portfolioId);
  const { data: holdings, isLoading: isHoldingsLoading } = useHoldings(portfolioId);
  const { data: closed, isLoading: isClosedLoading } = useClosedLots(portfolioId);

  const openSymbols = holdings?.map((h) => h.symbol) ?? [];
  const closedSymbols = closed?.lots.map((lot) => lot.symbol) ?? [];
  const selectedSymbol =
    pickedSymbol && (openSymbols.includes(pickedSymbol) || closedSymbols.includes(pickedSymbol))
      ? pickedSymbol
      : openSymbols[0] ?? closedSymbols[0];
  const { data: allocation, isLoading: isAllocationLoading } = usePortfolioAllocation(portfolioId);
  const { data: prices, isLoading: isPricesLoading } = useHoldingPrices(
    portfolioId,
    selectedSymbol,
    range
  );

  const currency = summary?.baseCurrency ?? "MYR";
  const selectedHolding = holdings?.find((h) => h.symbol === selectedSymbol);

  if (!portfolioId) return null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Holdings</h2>
        <RangeChips value={range} onChange={setRange} />
      </div>

      {selectedSymbol ? (
        <PriceChart
          data={prices}
          avgCost={selectedHolding ? Number(selectedHolding.avgCost) : undefined}
          isLoading={isPricesLoading}
        />
      ) : (
        <div className="h-72 rounded-xl bg-[var(--color-surface)] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
          Select a holding to view its price chart
        </div>
      )}

      <HoldingsTable
        holdings={holdings}
        allocation={allocation}
        currency={currency}
        isLoading={isHoldingsLoading || isAllocationLoading}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setPickedSymbol}
      />
      <ClosedLotsTable
        lots={closed?.lots}
        currency={currency}
        isLoading={isClosedLoading}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setPickedSymbol}
      />
    </>
  );
}
