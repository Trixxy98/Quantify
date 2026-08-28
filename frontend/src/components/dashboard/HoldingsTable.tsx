import type { Holding, PortfolioAllocation } from "../../types/api.types";
import { formatMoney, formatPctAbs } from "../../utils/format";

type Props = {
  holdings: Holding[] | undefined;
  allocation: PortfolioAllocation | undefined;
  currency: "MYR" | "USD";
  isLoading: boolean;
};

export function HoldingsTable({ holdings, allocation, currency, isLoading }: Props) {
  if (isLoading) {
    return <div className="h-40 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  if (!holdings || holdings.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-muted)]">
        No holdings
      </div>
    );
  }

  const valueBySymbol = new Map(allocation?.items.map((item) => [item.symbol, item]) ?? []);

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Holdings</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)]">
          <tr>
            <th className="pb-2 font-medium">Symbol</th>
            <th className="pb-2 font-medium">Exchange</th>
            <th className="pb-2 font-medium text-right">Quantity</th>
            <th className="pb-2 font-medium text-right">Avg Cost</th>
            <th className="pb-2 font-medium text-right">Market Value</th>
            <th className="pb-2 font-medium text-right">Allocation</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const alloc = valueBySymbol.get(holding.symbol);
            return (
              <tr key={holding.id} className="border-t border-slate-700">
                <td className="py-2 font-medium">{holding.symbol}</td>
                <td className="py-2 text-[var(--color-text-muted)]">{holding.exchange}</td>
                <td className="py-2 text-right">{Number(holding.quantity).toLocaleString()}</td>
                <td className="py-2 text-right">
                  {formatMoney(Number(holding.avgCost), holding.currency)}
                </td>
                <td className="py-2 text-right">
                  {alloc ? formatMoney(alloc.marketValue, currency) : "—"}
                </td>
                <td className="py-2 text-right">
                  {alloc ? formatPctAbs(alloc.percentage) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}