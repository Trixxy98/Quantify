import type {HealthStatus} from "../../types/api.types";

const STYLES: Record<HealthStatus, {label: string; className: string}> = {
    ok: {label: "OK", className: "bg-green-500/15 text-green-400"},
    warn: {label: "Check", className: "bg-amber-500/15 text-amber-400"},
    bad: {label: "Problem", className: "bg-red-500/15 text-red-400"},
};

export function StatusBadge({status}: {status: HealthStatus}) {
    const style = STYLES[status];
    return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${style.className}`}>{style.label}</span>;
}
