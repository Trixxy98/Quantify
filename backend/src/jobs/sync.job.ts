import cron from "node-cron";
import {syncMarketData} from "../services/market.service";
import {rebuildAllSnapshots} from "../services/snapshot.service";

export async function runFullSync(daysBack = 400) {
    const market = await syncMarketData(daysBack);
    const portfolios = await rebuildAllSnapshots();
    return {...market, portfolios};
}

// 6:30 pagi MYT, Selasa-Sabtu — selepas pasaran US tutup (4-5 pagi MYT).
// Sync harian cuma perlu 7 hari ke belakang (cover cuti panjang), bukan 400.
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