import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import type {AgentsOverview} from "../../types/api.types";
import {formatNumber, formatPct} from "../../utils/format";

export function DecisionEquityChart({evaluation}: {evaluation: AgentsOverview["evaluation"]}) {
    const best = evaluation.bestAgent ? `Best agent (${evaluation.bestAgent})` : "Best agent";
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium">Out-of-sample equity</h2>
                {evaluation.alpha && (
                    <p className="text-xs text-[var(--color-text-muted)]">
                        FF5+Mom alpha {formatPct(evaluation.alpha.annualized)} · t {formatNumber(evaluation.alpha.tStat)} · {evaluation.alpha.n} months
                    </p>
                )}
            </div>
            <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                {evaluation.notes[0]} {evaluation.months} months. Benchmark is the S&P 500 total return.
            </p>
            {evaluation.equity.length < 2 ? (
                <p className="text-sm text-[var(--color-text-muted)]">Not enough scored months to draw a curve.</p>
            ) : (
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={evaluation.equity}>
                            <CartesianGrid stroke="#243049" strokeDasharray="3 3" />
                            <XAxis dataKey="month" tick={{fill: "#8b9bb4", fontSize: 11}} minTickGap={28} />
                            <YAxis tick={{fill: "#8b9bb4", fontSize: 12}} />
                            <Tooltip contentStyle={{background: "#0c1222", border: "1px solid #243049"}} />
                            <Legend />
                            <Line type="monotone" dataKey="strategy" name="Decision book" stroke="#3dbe86" dot={false} strokeWidth={2} />
                            <Line type="monotone" dataKey="bestAgent" name={best} stroke="#c4b5fd" dot={false} />
                            <Line type="monotone" dataKey="equalWeight" name="Equal weight" stroke="#7dd3fc" dot={false} />
                            <Line type="monotone" dataKey="buyHold" name="Buy and hold" stroke="#8b9bb4" dot={false} />
                            <Line type="monotone" dataKey="benchmark" name="S&P 500 TR" stroke="#fbbf24" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
