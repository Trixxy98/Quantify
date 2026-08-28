import type { AttributionItem, Currency } from "../../types/api.types";
import { formatMoney, formatNumber, formatPct, formatPctAbs, toneClass } from "../../utils/format";

type Props = {
  items: AttributionItem[];
  currency: Currency;
  isLoading: boolean;
};

export function AttributionTable({ items, currency, isLoading }: Props) {
  if (isLoading) {
    return <div className="h-40 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Attribution</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Stock is local-price P&amp;L. FX is currency translation. Risk share is % of portfolio variance.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No attribution for this range — add trades and sync prices</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="pb-2 font-medium">Symbol</th>
              <th className="pb-2 font-medium text-right">Weight</th>
              <th className="pb-2 font-medium text-right">Contribution</th>
              <th className="pb-2 font-medium text-right">Stock</th>
              <th className="pb-2 font-medium text-right">FX</th>
              <th className="pb-2 font-medium text-right">Risk</th>
              <th className="pb-2 font-medium text-right">Beta</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.symbol} className="border-t border-slate-700">
                <td className="py-2 font-medium">{row.symbol}</td>
                <td className="py-2 text-right">{formatPctAbs(row.weight)}</td>
                <td className={`py-2 text-right ${toneClass(row.contribution)}`}>
                  <div>{formatMoney(row.contribution, currency)}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{formatPct(row.contributionShare)}</div>
                </td>
                <td className={`py-2 text-right ${toneClass(row.stockContribution)}`}>
                  {formatMoney(row.stockContribution, currency)}
                </td>
                <td className={`py-2 text-right ${toneClass(row.fxContribution)}`}>
                  {formatMoney(row.fxContribution, currency)}
                </td>
                <td className="py-2 text-right">{formatPctAbs(row.riskShare)}</td>
                <td className="py-2 text-right">{formatNumber(row.beta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
