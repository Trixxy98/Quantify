import {HealthTable} from "../components/data/HealthTable";
import {SyncRunsCard} from "../components/data/SyncRunsCard";
import {MetricCard} from "../components/dashboard/MetricCard";
import {useDataHealth} from "../hooks/useDataHealth";

export default function DataPage() {
    const {data, isLoading, isError} = useDataHealth();
    const lastOk = data?.sync.lastOk;

    return (
        <>
            <div>
                <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Data</h2>
                <p className="mt-1 max-w-3xl text-xs text-[var(--color-text-muted)]">
                    Read-only checks on the stored series behind every number in the app, worst first.
                    {data && ` Latest session expected: US ${data.expected.US}, Bursa ${data.expected.BURSA}.`}
                </p>
            </div>

            {isError && <p className="text-sm text-[var(--color-danger)]">Could not load the data checks.</p>}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Problems" value={data ? String(data.counts.bad) : "—"} hint="series to fix or explain" isLoading={isLoading} />
                <MetricCard label="To check" value={data ? String(data.counts.warn) : "—"} hint="often a holiday or one late bar" isLoading={isLoading} />
                <MetricCard label="OK" value={data ? String(data.counts.ok) : "—"} isLoading={isLoading} />
                <MetricCard
                    label="Last good sync"
                    value={lastOk?.finishedAt ? new Date(lastOk.finishedAt).toLocaleString() : "—"}
                    hint={lastOk ? `trigger: ${lastOk.trigger}` : "none recorded"}
                    isLoading={isLoading}
                />
            </section>

            {data && <SyncRunsCard sync={data.sync} />}
            {data && <HealthTable rows={data.rows} />}

            {data?.notes.map((note) => (
                <p key={note} className="text-xs text-[var(--color-text-muted)]">· {note}</p>
            ))}
        </>
    );
}
