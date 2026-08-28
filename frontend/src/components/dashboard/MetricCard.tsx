import {toneClass} from "../../utils/format";

type MetricCardProps = {
    label: string;
    value: string;
    hint?: string;
    tone?: number;
    isLoading?: boolean;
};

export function MetricCard({label, value, hint, tone, isLoading}: MetricCardProps) {
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-4 space-y-1">
            <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
            {isLoading ? (
                <div className="h-7 w-28 rounded bg-slate-700/50 animate-pulse" />
            ) : (
                <p className={`text-xl font-semibold tabular-nums ${tone !== undefined ? toneClass(tone) : ""}`}>
                    {value}
                </p>
            )}
            {hint && !isLoading && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
        </div>
    )
}