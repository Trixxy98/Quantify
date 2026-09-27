import {useState} from "react";
import {useOutletContext} from "react-router-dom";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import {MetricCard} from "../components/dashboard/MetricCard";
import type {AppShellContext} from "../components/layout/AppShell";
import {useMomentum} from "../hooks/useMomentum";
import type {MomentumStats} from "../types/api.types";
import {formatNumber, formatPct, formatPctAbs} from "../utils/format";

const chip = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs ${active ? "bg-[var(--color-accent)] text-slate-900" : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`;

function row(label: string, stats: MomentumStats | null) {
    if (!stats) return {label, ann: "—", sharpe: "—", dd: "—", hit: "—", turn: "—"};
    return {
        label,
        ann: formatPct(stats.annualizedReturn),
        sharpe: `${formatNumber(stats.sharpe)} ± ${formatNumber(stats.sharpeSe)}`,
        dd: formatPct(stats.maxDrawdown),
        hit: stats.hitRate == null ? "—" : formatPctAbs(stats.hitRate, 0),
        turn: stats.avgTurnover == null ? "—" : formatPctAbs(stats.avgTurnover, 0),
    };
}

export default function ResearchPage() {
    const {portfolioId} = useOutletContext<AppShellContext>();
    const [universe, setUniverse] = useState<"holdings" | "basket">("basket");
    const [allowShort, setAllowShort] = useState(false);
    const [commissionBps, setCommissionBps] = useState(5);
    const [slippageBps, setSlippageBps] = useState(5);

    const enabled = universe === "basket" || Boolean(portfolioId);
    const {data, isLoading, isError} = useMomentum(
        {portfolioId, universe, commissionBps, slippageBps, allowShort},
        enabled
    );

    const rows = data
        ? [
            row("Momentum", data.strategy),
            row("Buy and hold", data.buyHold),
            row("Equal weight", data.equalWeight),
            row(data.benchmarkSymbol ?? "S&P 500", data.benchmark),
        ]
        : [];
    const logScale = (data?.equity ?? []).every((point) => point.strategy > 0 && point.buyHold > 0 && point.equalWeight > 0);

    return (
        <>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Research</h2>
                    <p className="mt-1 max-w-3xl text-xs text-[var(--color-text-muted)]">
                        One signal, not a search. 12-1 momentum, monthly, top third. Out of sample by construction:
                        the rank cannot see the month it is held.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={chip(universe === "basket")} onClick={() => setUniverse("basket")}>Basket</button>
                    <button type="button" className={chip(universe === "holdings")} onClick={() => setUniverse("holdings")}>Holdings</button>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                        <input type="checkbox" checked={allowShort} onChange={(event) => setAllowShort(event.target.checked)} />
                        Short bottom third
                    </label>
                    <label className="text-xs text-[var(--color-text-muted)]">
                        Commission
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={commissionBps}
                            onChange={(event) => setCommissionBps(Number(event.target.value))}
                            className="ml-1 w-14 rounded-md bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)]"
                        />
                    </label>
                    <label className="text-xs text-[var(--color-text-muted)]">
                        Slippage
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={slippageBps}
                            onChange={(event) => setSlippageBps(Number(event.target.value))}
                            className="ml-1 w-14 rounded-md bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)]"
                        />
                    </label>
                </div>
            </div>

            {isError && <p className="text-sm text-[var(--color-danger)]">Could not run the momentum study.</p>}

            {data && (
                <p className="rounded-xl bg-[var(--color-surface)] px-4 py-3 text-sm">{data.conclusion}</p>
            )}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Momentum"
                    value={data?.strategy ? formatPct(data.strategy.annualizedReturn) : "—"}
                    hint={data?.from ? `${data.from} to ${data.to}` : "annualized, after costs"}
                    tone={data?.strategy?.annualizedReturn}
                    isLoading={isLoading}
                />
                <MetricCard
                    label="Sharpe"
                    value={data?.strategy ? formatNumber(data.strategy.sharpe) : "—"}
                    hint={data?.strategy ? `± ${formatNumber(data.strategy.sharpeSe)}` : undefined}
                    isLoading={isLoading}
                />
                <MetricCard
                    label="Factor alpha"
                    value={data?.alpha ? formatPct(data.alpha.annualized) : "—"}
                    hint={data?.alpha ? `± ${formatPct(data.alpha.se)} · t ${formatNumber(data.alpha.tStat)}` : "Fama–French plus momentum"}
                    tone={data?.alpha?.annualized}
                    isLoading={isLoading}
                />
                <MetricCard
                    label="Avg turnover"
                    value={data?.strategy?.avgTurnover != null ? formatPctAbs(data.strategy.avgTurnover, 0) : "—"}
                    hint={data ? `long ${data.longCount}${data.shortCount ? ` / short ${data.shortCount}` : ""} · hit ${data.strategy?.hitRate != null ? formatPctAbs(data.strategy.hitRate, 0) : "—"}` : undefined}
                    isLoading={isLoading}
                />
            </section>

            {data && data.equity.length > 0 && (
                <div className="rounded-xl bg-[var(--color-surface)] p-5">
                    <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Out-of-sample equity</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mb-4">
                        Indexed to 100 at the first held month. {logScale ? "Log scale." : "Linear scale."}{" "}
                        {data.latestLong.length > 0 && `Latest long book: ${data.latestLong.join(", ")}.`}
                    </p>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.equity}>
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                                <XAxis dataKey="date" tick={{fill: "#94a3b8", fontSize: 11}} minTickGap={32} />
                                <YAxis scale={logScale ? "log" : "auto"} domain={["auto", "auto"]} tick={{fill: "#94a3b8", fontSize: 12}} />
                                <Tooltip contentStyle={{background: "#0f172a", border: "1px solid #334155"}} />
                                <Legend />
                                <Line type="monotone" dataKey="strategy" name="Momentum" stroke="#22c55e" dot={false} strokeWidth={2} />
                                <Line type="monotone" dataKey="buyHold" name="Buy and hold" stroke="#94a3b8" dot={false} />
                                <Line type="monotone" dataKey="equalWeight" name="Equal weight" stroke="#38bdf8" dot={false} />
                                <Line type="monotone" dataKey="benchmark" name={data.benchmarkSymbol ?? "S&P 500"} stroke="#f59e0b" dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {data && data.excess.length > 0 && (
                <div className="rounded-xl bg-[var(--color-surface)] p-5">
                    <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Rolling 12-month excess vs buy-and-hold</h2>
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.excess}>
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                                <XAxis dataKey="date" tick={{fill: "#94a3b8", fontSize: 11}} minTickGap={32} />
                                <YAxis tick={{fill: "#94a3b8", fontSize: 12}} tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`} />
                                <Tooltip
                                    contentStyle={{background: "#0f172a", border: "1px solid #334155"}}
                                    formatter={(value) => formatPct(Number(value))}
                                />
                                <Line type="monotone" dataKey="value" name="Excess" stroke="#a78bfa" dot={false} strokeWidth={1.5} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {data && data.turnover.length > 0 && (
                <div className="rounded-xl bg-[var(--color-surface)] p-5">
                    <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Monthly turnover</h2>
                    <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.turnover}>
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                                <XAxis dataKey="month" tick={{fill: "#94a3b8", fontSize: 11}} minTickGap={24} />
                                <YAxis tick={{fill: "#94a3b8", fontSize: 12}} tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`} />
                                <Tooltip
                                    contentStyle={{background: "#0f172a", border: "1px solid #334155"}}
                                    formatter={(value) => formatPctAbs(Number(value), 0)}
                                />
                                <Bar dataKey="turnover" name="Turnover" fill="#38bdf8" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {rows.length > 0 && (
                <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left text-[var(--color-text-muted)]">
                            <tr>
                                <th className="pb-2 font-medium">Book</th>
                                <th className="pb-2 font-medium text-right">Annualized</th>
                                <th className="pb-2 font-medium text-right">Sharpe</th>
                                <th className="pb-2 font-medium text-right">Max drawdown</th>
                                <th className="pb-2 font-medium text-right">Hit rate</th>
                                <th className="pb-2 font-medium text-right">Avg turnover</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((item) => (
                                <tr key={item.label} className="border-t border-slate-700">
                                    <td className="py-1.5">{item.label}</td>
                                    <td className="py-1.5 text-right tabular-nums">{item.ann}</td>
                                    <td className="py-1.5 text-right tabular-nums">{item.sharpe}</td>
                                    <td className="py-1.5 text-right tabular-nums">{item.dd}</td>
                                    <td className="py-1.5 text-right tabular-nums">{item.hit}</td>
                                    <td className="py-1.5 text-right tabular-nums">{item.turn}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {data?.notes.map((note) => (
                <p key={note} className="text-xs text-[var(--color-text-muted)]">· {note}</p>
            ))}
        </>
    );
}
