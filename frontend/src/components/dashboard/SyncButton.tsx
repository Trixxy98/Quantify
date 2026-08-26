import {useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {syncMarketData} from "../../api/portfolio.api";


export function SyncButton() {
    const queryClient = useQueryClient();
    const [message, setMessage] = useState<string | null>(null);

    const mutation = useMutation({
        mutationFn: syncMarketData,
        onSuccess: async () => {
            setMessage("Sync successfully");
            await queryClient.invalidateQueries({queryKey: ["portfolio"]});
            await queryClient.invalidateQueries({queryKey: ["portfolios"]});
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
            className="rounded-md border border-slate-600 px-3 py-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
                {mutation.isPending ? "Syncing..." : "Sync"}
            </button>
            {message && <span className="text-xs text-[var(--color-text-muted)]">{message}</span>}
        </div>
    );
}