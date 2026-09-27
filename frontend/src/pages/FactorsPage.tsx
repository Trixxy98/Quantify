import {useState} from "react";
import {useOutletContext} from "react-router-dom";
import {
    Bar,
    BarChart,
    CartesianGrid,
    ErrorBar,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import {MetricCard} from "../components/dashboard/MetricCard";
import {RangeChips} from "../components/dashboard/RangeChips";
import type {AppShellContext} from "../components/layout/AppShell";
import {useFactorExposure} from "../hooks/useFactorExposure";
import type {Range} from "../types/api.types";
import {formatNumber, formatPct} from "../utils/format";

const LABELS: Record<string, string> = {
    "Mkt-RF": "Market",
    SMB: "Size",
    HML: "Value",
    RMW: "Profitability",
    CMA: "Investment",
    Mom: "Momentum",
};

const COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#a78bfa", "#fb7185", "#e2e8f0"];

export default function FactorsPage() {
    const {portfolioId} = useOutletContext<AppShellContext>();
    const [range, setRange] = useState<Range>("1Y");
    const {data, isLoading} = useFactorExposure(portfolioId, range);

    if (!portfolioId) return null;

    const bars = (data?.loadings ?? []).map((row) => ({
        name: LABELS[row.factor] ?? row.factor,
        beta: row.beta,
        se: row.se,
        tStat: row.tStat,
    }));
    const rolling = (data?.rolling ?? []).map((point) => ({
        date: point.date,
        ...Object.fromEntries(point.loadings.map((row) => [row.factor, row.beta])),
    }));
    const factorKeys = data?.loadings?.map((row) => row.factor) ?? Object.keys(LABELS);

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Factors</h2>
                    <p className="mt-1 max-w-3xl text-xs text-[var(--color-text-muted)]">
                        Fama–French five factors plus momentum, on the US sleeve only. Bursa holdings are not in this
                        regression.
                    </p>
                </div>
                <RangeChips value={range} onChange={setRange} />
            </div>

            {data?.notes.map((note) => (
                <p key={note} className="text-xs text-[var(--color-text-muted)]">· {note}</p>
            ))}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Alpha"
                    value={data?.alpha != null ? formatPct(data.alpha) : "—"}
                    hint={data?.alphaSe != null ? `± ${formatPct(data.alphaSe)} annualized` : "annualized intercept"}
                    tone={data?.alpha ?? undefined}
                    isLoading={isLoading}
                />
                <MetricCard
                    label="Alpha t-stat"
                    value={data?.alphaT != null ? formatNumber(data.alphaT) : "—"}
                    hint="Newey–West, 5 lags"
                    isLoading={isLoading}
                />
                <MetricCard
                    label="R²"
                    value={data?.rSquared != null ? formatNumber(data.rSquared, 2) : "—"}
                    hint={data ? `${data.n} sessions` : undefined}
                    isLoading={isLoading}
                />
                <MetricCard
                    label="Factors through"
                    value={data?.dataThrough ?? "—"}
                    hint="Ken French publishes monthly"
                    isLoading={isLoading}
                />
            </section>

            {bars.length > 0 && (
                <div className="rounded-xl bg-[var(--color-surface)] p-5">
                    <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Loadings</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mb-4">
                        Bars are betas. Whiskers are one Newey–West standard error. A market beta near 1 with the others
                        near 0 is a plain equity book.
                    </p>
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={bars}>
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{fill: "#94a3b8", fontSize: 12}} />
                                <YAxis tick={{fill: "#94a3b8", fontSize: 12}} />
                                <Tooltip
                                    contentStyle={{background: "#0f172a", border: "1px solid #334155"}}
                                    formatter={(value, name) => [formatNumber(Number(value), 2), name === "se" ? "std. error" : "beta"]}
                                />
                                <Bar dataKey="beta" fill="#38bdf8" name="beta">
                                    <ErrorBar dataKey="se" width={6} stroke="#e2e8f0" />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <table className="mt-4 w-full text-sm">
                        <thead className="text-left text-[var(--color-text-muted)]">
                            <tr>
                                <th className="pb-2 font-medium">Factor</th>
                                <th className="pb-2 font-medium text-right">Beta</th>
                                <th className="pb-2 font-medium text-right">Std. error</th>
                                <th className="pb-2 font-medium text-right">t</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bars.map((row) => (
                                <tr key={row.name} className="border-t border-slate-700">
                                    <td className="py-1.5">{row.name}</td>
                                    <td className="py-1.5 text-right tabular-nums">{formatNumber(row.beta, 2)}</td>
                                    <td className="py-1.5 text-right tabular-nums">{formatNumber(row.se, 2)}</td>
                                    <td className="py-1.5 text-right tabular-nums">{formatNumber(row.tStat, 2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {rolling.length > 0 && (
                <div className="rounded-xl bg-[var(--color-surface)] p-5">
                    <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Rolling loadings</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mb-4">Trailing 252 sessions, stepped one day.</p>
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={rolling}>
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                                <XAxis dataKey="date" tick={{fill: "#94a3b8", fontSize: 11}} minTickGap={32} />
                                <YAxis tick={{fill: "#94a3b8", fontSize: 12}} />
                                <Tooltip contentStyle={{background: "#0f172a", border: "1px solid #334155"}} />
                                <Legend />
                                {factorKeys.map((factor, i) => (
                                    <Line
                                        key={factor}
                                        type="monotone"
                                        dataKey={factor}
                                        name={LABELS[factor] ?? factor}
                                        stroke={COLORS[i % COLORS.length]}
                                        dot={false}
                                        strokeWidth={1.5}
                                    />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </>
    );
}
