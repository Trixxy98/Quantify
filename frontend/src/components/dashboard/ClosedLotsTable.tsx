import type { ClosedLot, Currency } from "../../types/api.types";
import { formatMoney, formatPct, toneClass } from "../../utils/format";

type Props = {
  lots: ClosedLot[] | undefined;
  currency: Currency;
  isLoading: boolean;
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
};

export function ClosedLotsTable({
  lots,
  currency,
  isLoading,
  selectedSymbol,
  onSelectSymbol,
}: Props) {
  if (isLoading) {
    return <div className="h-40 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  if (!lots || lots.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-muted)]">
        No closed lots yet — a lot appears when a symbol is sold back to zero.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Closed lots</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Weighted-average round trips. Click a row to view the price chart.
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)]">
          <tr>
            <th className="pb-2 font-medium">Symbol</th>
            <th className="pb-2 font-medium">Opened</th>
            <th className="pb-2 font-medium">Closed</th>
            <th className="pb-2 font-medium text-right">Qty</th>
            <th className="pb-2 font-medium text-right">Cost</th>
            <th className="pb-2 font-medium text-right">Proceeds</th>
            <th className="pb-2 font-medium text-right">Realized P&L</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr
              key={`${lot.symbol}-${lot.openedAt}-${lot.closedAt}`}
              className={`border-t border-slate-700 ${
                onSelectSymbol ? "cursor-pointer hover:bg-slate-800/60" : ""
              } ${selectedSymbol === lot.symbol ? "bg-slate-800/80" : ""}`}
              onClick={() => onSelectSymbol?.(lot.symbol)}
            >
              <td className="py-2 font-medium">{lot.symbol}</td>
              <td className="py-2 text-[var(--color-text-muted)]">{lot.openedAt}</td>
              <td className="py-2 text-[var(--color-text-muted)]">{lot.closedAt}</td>
              <td className="py-2 text-right">{lot.quantity.toLocaleString()}</td>
              <td className="py-2 text-right">{formatMoney(lot.cost, lot.currency)}</td>
              <td className="py-2 text-right">{formatMoney(lot.proceeds, lot.currency)}</td>
              <td className={`py-2 text-right ${toneClass(lot.realizedPnLBase)}`}>
                <div>{formatMoney(lot.realizedPnLBase, currency)}</div>
                <div className="text-xs">{formatPct(lot.realizedPnLPct)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
