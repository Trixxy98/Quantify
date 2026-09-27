import cron from "node-cron";
import {getTrackedSymbols, syncMarketData} from "../services/market.service";
import {rebuildAllSnapshots} from "../services/snapshot.service";
import {captureImpliedSnapshots} from "../services/impliedSnapshot.service";
import {refreshFactorsIfStale} from "../services/factors.service";
import {AppError} from "../utils/AppError";

let isSyncRunning = false;

export function isFullSyncRunning() {
    return isSyncRunning;
}

export async function runFullSync(daysBack = 400) {
    if (isSyncRunning) {
        throw new AppError(409, "SYNC_IN_PROGRESS", "Sync is already running, try again later");
    }
    isSyncRunning = true;
    try {
        const market = await syncMarketData(daysBack);
        const portfolios = await rebuildAllSnapshots();
        // Yahoo has no IV history, so today's front-month ATM straddle is the
        // only chance to record it. Upserts by session, so a manual sync
        // during US hours is overwritten by the closing marks next morning.
        const implied = await captureImpliedSnapshots(await getTrackedSymbols());
        const factors = await refreshFactorsIfStale();
        return {...market, portfolios, impliedSnapshots: implied.recorded, factorsThrough: factors.through};
    } finally {
        isSyncRunning = false;
    }
}


// 6:30am MYT, Tue–Sat — after US market close (4–5am MYT).
// Daily sync only needs 7 days back (covers long weekends), not 400.
export function scheduleDailySync() {
    cron.schedule(
        "30 6 * * 2-6",
        async () => {
            try {
                const result = await runFullSync(7);
                console.log("[sync] Daily sync completed successfully", result);
            } catch (err) {
                console.error("[sync] Daily sync failed", err);
            }
        },
        {timezone: "Asia/Kuala_Lumpur"}
    );
}