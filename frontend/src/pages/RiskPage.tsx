import {useState} from "react";
import {useOutletContext} from "react-router-dom";
import {CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {MetricCard} from "../components/dashboard/MetricCard";
import {RangeChips} from "../components/dashboard/RangeChips";
import type {AppShellContext} from "../components/layout/AppShell";
import {usePortfolioRisk} from "../hooks/usePortfolioRisk";
import type {Range} from "../types/api.types";
import {formatNumber, formatPct, formatPctAbs} from "../utils/format";

function heat(value: number) {
    const alpha = 0.15 + Math.min(1, Math.abs(value)) * 0.75;
    return value >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
}

export default function RiskPage() {
    const {portfolioId} = useOutletContext<AppShellContext>();
    const [range, setRange] = useState<Range>("1Y");
    const {data, isLoading} = usePortfolioRisk(portfolioId, range);

    if (!portfolioId) return null;

    const path = data?.path;
    const kupiec = path?.kupiec;

    return (
        <>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Risk</h2>
            <RangeChips value={range} onChange={setRange} />
        </div>

        {data?.notes.map((note) => (
            <p key={note} className="text-sm text-[var(--color-text-muted)]">{note}</p>
        ))}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Volatility" value={path ? formatPctAbs(path.volatility) : "—"} hint="TWR, annualized" isLoading={isLoading} />
        <MetricCard label="VaR 95%" value={path?.var95 != null ? formatPct(path.var95) : "—"} hint="Historical daily" tone={path?.var95 ?? undefined} isLoading={isLoading} />
        <MetricCard label="Expected shortfall 95%" value={path?.es95 != null ? formatPct(path.es95) : "—"} hint="Mean beyond VaR" tone={path?.es95 ?? undefined} isLoading={isLoading} />
        <MetricCard label="Max drawdown" value={path ? formatPct(path.maxDrawdown) : "—"} tone={path?.maxDrawdown} isLoading={isLoading} />
        <MetricCard label="Calmar" value={path?.calmar != null ? formatNumber(path.calmar) : "—"} hint="Annual return / |max DD|" isLoading={isLoading} />
        <MetricCard label="Ulcer index" value={path ? formatPctAbs(path.ulcer) : "—"} hint="RMS drawdown" isLoading={isLoading} />
        <MetricCard
          label="VaR breaches"
          value={kupiec ? `${kupiec.breaches} / ${kupiec.trials}` : "—"}
          hint={kupiec ? `Expected ${kupiec.expected.toFixed(1)} · ${kupiec.rejectAt5Pct ? "Kupiec rejects" : "Kupiec holds"}` : "Needs 60+ days"}
          isLoading={isLoading}
        />
        <MetricCard label="VaR 99%" value={path?.var99 != null ? formatPct(path.var99) : "—"} tone={path?.var99 ?? undefined} isLoading={isLoading} />
        </section>

        <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
            <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Where the risk sits</h2>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
                Risk share is this name's slice of portfolio volatility. Marginal vol is the change in portfolio volatility if its weight rises by 1.
            </p>
            <table className="w-full text-sm">
                <thead className="text-left text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Symbol</th>
                        <th className="pb-2 font-medium text-right">Symbol</th>
                        <th className="pb-2 font-medium text-right">Close vol</th>
                        <th className="pb-2 font-medium text-right">GK vol</th>
                        <th className="pb-2 font-medium text-right">Beta</th>
                        <th className="pb-2 font-medium text-right">Marginal</th>
                        <th className="pb-2 font-medium text-right">Risk share</th>
                    </tr>
                </thead>
                <tbody>
                    {(data?.names ?? []).map((row) => (
                        <tr>
                            <td className="py-2 font-medium">{row.symbol}</td>
                            <td className="py-2 text-right">{formatPctAbs(row.weight)}</td>
                            <td className="py-2 text-right">{formatPctAbs(row.closeToCloseVol)}</td>
                            <td className="py-2 text-right">{formatPctAbs(row.gkVol)}</td>
                            <td className="py-2 text-right">{row.beta == null ? "—" : formatNumber(row.beta)}</td>
                            <td className="py-2 text-right">{row.mctr == null ? "—" : formatPctAbs(row.mctr)}</td>
                            <td className="py-2 text-right">{row.riskShare == null ? "—" : formatPctAbs(row.riskShare)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {data && data.correlation.symbols.length > 1 && (
            <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
                <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Correlation</h2>
                <table className="text-xs">
                    <thead>
                        <tr>
                            <th />
                            {data.correlation.symbols.map((symbol) => (
                                <th key={symbol} className="px-2 pb-2 font-medium text-[var(--color-text-muted)]">{symbol}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.correlation.matrix.map((row, i) => (
                            <tr key={data.correlation.symbols[i]}>
                                <th className="pr-2 text-left font-medium text-[var(--color-text-muted)]">{data.correlation.symbols[i]}</th>
                                {row.map((value, j) => (
                                    <td key={j} className="px-2 py-1 text-center tabular-nums" style={{backgroundColor: heat(value)}}>
                                        {value.toFixed(2)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-xl bg-[var(--color-surface)] p-5">
                <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Underwater</h2>
                <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data?.underwater ?? []}>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{fill: "#94a3b8", fontSize: 12}} tickFormatter={(value: string) => value.slice(5)} />
                        <YAxis tick={{fill: "#94a3b8", fontSize: 12}} tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`} />
                        <Tooltip contentStyle={{backgroundColor: "#1e293b", border: "1px solid #334155"}} formatter={(value) => [formatPct(Number(value)), "Drawdown"]} />
                        <Line type="monotone" dataKey="drawdown" stroke="#ef4444" dot={false} strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
                </div>
            </div>
            <div className="rounded-xl bg-[var(--color-surface)] p-5">
                <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Rolling 60-day vol and beta</h2>
                <div>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data?.rolling ?? []}>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{fill: "#94a3b8", fontSize: 12}} tickFormatter={(value: string) => value.slice(5)} />
                        <YAxis tick={{fill: "#94a3b8", fontSize: 12}} />
                        <Tooltip contentStyle={{backgroundColor: "#1e293b", border: "1px solid #334155"}} />
                        <Line type="monotone" dataKey="vol" name="Vol" stroke="#38bdf8" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="beta" name="Beta" stroke="#a78bfa" dot={false} strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
                </div>
            </div>
        </div>

        <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
            <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Worst drawdowns</h2>
            <table className="w-full text-sm">
                <thead className="text-left text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Peak</th>
                        <th className="pb-2 font-medium">Trough</th>
                        <th className="pb-2 font-medium">Recovered</th>
                        <th className="pb-2 font-medium text-right">Depth</th>
                        <th className="pb-2 font-medium text-right">Days down</th>
                        <th className="pb-2 font-medium text-right">Days to recover</th>
                    </tr>
                </thead>
                <tbody>
                    {(data?.drawdowns ?? []).map((row) => (
                        <tr>
                            <td className="py-2">{row.peak}</td>
                            <td className="py-2">{row.trough}</td>
                            <td className="py-2">{row.recovered ?? "Open"}</td>
                            <td className="py-2 text-right text-[var(--color-danger)]">{formatPct(row.depth)}</td>
                            <td className="py-2 text-right">{row.daysToTrough}</td>
                            <td className="py-2 text-right">{row.daysToRecover ?? "—"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        </>
    )
}
