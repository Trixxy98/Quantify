import {useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {syncMarketData} from "../../api/portfolio.api";


export function SyncButton() {
    const queryClient = useQueryClient();
    const [message, setMessage] = useState<string | null>(null);

    const mutation = useMutation({
        mutationFn: syncMarketData,
        onSuccess: async () => {
            setMessage("Synced successfully");
            // Prices, IV snapshots, headlines and agent runs all change, so every page's data is stale.
            await queryClient.invalidateQueries();
            queryClient.setQueriesData({predicate: (query) => query.queryKey[0] === "portfolio" && query.queryKey[2] === "tradeRefresh"}, "complete");
        },
        onError: () => {
            setMessage("Failed to sync market data. Please try again.");
        },
    });

    return (
        <div className="flex items-center gap-3">
            <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
                {mutation.isPending ? "Syncing..." : "Sync"}
            </button>
            {message && <span role="status" className="fixed bottom-16 right-4 z-40 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] shadow-xl sm:right-6">{message}</span>}
        </div>
    );
}
