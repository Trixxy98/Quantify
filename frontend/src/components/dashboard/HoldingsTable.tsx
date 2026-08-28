import type { Holding, PortfolioAllocation } from "../../types/api.types";
import { formatMoney, formatPct, formatPctAbs, toneClass } from "../../utils/format";

type Props = {
  holdings: Holding[] | undefined;
  allocation: PortfolioAllocation | undefined;
  currency: "MYR" | "USD";
  isLoading: boolean;
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
};

export function HoldingsTable({
  holdings,
  allocation,
  currency,
  isLoading,
  selectedSymbol,
  onSelectSymbol,
}: Props) {
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
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Holdings</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">Click a row to view the price chart</p>
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)]">
          <tr>
            <th className="pb-2 font-medium">Symbol</th>
            <th className="pb-2 font-medium">Exchange</th>
            <th className="pb-2 font-medium text-right">Quantity</th>
            <th className="pb-2 font-medium text-right">Avg Cost</th>
            <th className="pb-2 font-medium text-right">Last</th>
            <th className="pb-2 font-medium text-right">Market Value</th>
            <th className="pb-2 font-medium text-right">P&L</th>
            <th className="pb-2 font-medium text-right">Allocation</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const alloc = valueBySymbol.get(holding.symbol);
            return (
              <tr
                key={holding.id}
                className={`border-t border-slate-700 ${
                  onSelectSymbol ? "cursor-pointer hover:bg-slate-800/60" : ""
                } ${selectedSymbol === holding.symbol ? "bg-slate-800/80" : ""}`}
                onClick={() => onSelectSymbol?.(holding.symbol)}
              >
                <td className="py-2 font-medium">{holding.symbol}</td>
                <td className="py-2 text-[var(--color-text-muted)]">{holding.exchange}</td>
                <td className="py-2 text-right">{Number(holding.quantity).toLocaleString()}</td>
                <td className="py-2 text-right">
                  {formatMoney(Number(holding.avgCost), holding.currency)}
                </td>
                <td className="py-2 text-right">
                  {holding.lastPrice != null
                    ? formatMoney(Number(holding.lastPrice), holding.currency)
                    : "—"}
                </td>
                <td className="py-2 text-right">
                  {holding.marketValue != null
                    ? formatMoney(holding.marketValue, currency)
                    : alloc
                      ? formatMoney(alloc.marketValue, currency)
                      : "—"}
                </td>
                <td className={`py-2 text-right ${holding.unrealizedPnL != null ? toneClass(holding.unrealizedPnL) : ""}`}>
                  {holding.unrealizedPnL != null ? (
                    <>
                      <div>{formatMoney(holding.unrealizedPnL, currency)}</div>
                      {holding.unrealizedPnLPct != null && (
                        <div className="text-xs">{formatPct(holding.unrealizedPnLPct)}</div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
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