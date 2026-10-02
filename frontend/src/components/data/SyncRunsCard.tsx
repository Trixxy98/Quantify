import type {DataHealth} from "../../types/api.types";
import {StatusBadge} from "./StatusBadge";

function formatTime(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : "—";
}

export function SyncRunsCard({sync}: {sync: DataHealth["sync"]}) {
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
            <div className="mb-3 flex items-center gap-3">
                <h2 className="text-sm text-[var(--color-text-muted)]">Sync runs</h2>
                <StatusBadge status={sync.status} />
                {sync.inFlightSince && (
                    <span className="text-xs text-[var(--color-text-muted)]">Running since {formatTime(sync.inFlightSince)}</span>
                )}
            </div>
            {sync.issues.map((issue) => (
                <p key={issue} className="mb-1 text-xs text-[var(--color-text-muted)]">· {issue}</p>
            ))}
            <table className="mt-2 w-full text-sm">
                <thead className="text-left text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Trigger</th>
                        <th className="pb-2 font-medium">Started</th>
                        <th className="pb-2 font-medium">Finished</th>
                        <th className="pb-2 font-medium">Result</th>
                    </tr>
                </thead>
                <tbody>
                    {sync.latestByTrigger.length === 0 && (
                        <tr>
                            <td colSpan={4} className="py-2 text-[var(--color-text-muted)]">No sync has run since run logging was added.</td>
                        </tr>
                    )}
                    {sync.latestByTrigger.map((run) => (
                        <tr key={run.trigger} className="border-t border-slate-700">
                            <td className="py-1.5">{run.trigger}</td>
                            <td className="py-1.5 tabular-nums">{formatTime(run.startedAt)}</td>
                            <td className="py-1.5 tabular-nums">{formatTime(run.finishedAt)}</td>
                            <td className="py-1.5">
                                {run.finishedAt == null ? (
                                    "running or killed"
                                ) : run.ok ? (
                                    <span className="text-[var(--color-accent)]">ok</span>
                                ) : (
                                    <span className="text-[var(--color-danger)]">{run.error ?? "failed"}</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
