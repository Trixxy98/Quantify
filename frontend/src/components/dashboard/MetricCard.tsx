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
        <div className="min-w-0 rounded-xl bg-[var(--color-surface)] p-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
            {isLoading ? (
                <div className="h-7 w-28 rounded bg-slate-700/50 animate-pulse" />
            ) : (
                <p className={`break-words text-xl font-semibold leading-tight tracking-tight tabular-nums sm:text-2xl ${tone !== undefined ? toneClass(tone) : ""}`}>
                    {value}
                </p>
            )}
            {hint && !isLoading && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
        </div>
    )
}
