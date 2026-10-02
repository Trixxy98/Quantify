import cron from "node-cron";
import {prisma} from "../lib/prisma";
import {getTrackedSymbols, syncMarketData} from "../services/market.service";
import {rebuildAllSnapshots} from "../services/snapshot.service";
import {captureImpliedSnapshots} from "../services/impliedSnapshot.service";
import {refreshFactorsIfStale} from "../services/factors.service";
import {AppError} from "../utils/AppError";
import {latestUsSessionClose} from "./usSession";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS_BACK = 7;
const MAX_DAYS_BACK = 400;
/** A run unfinished after this long is assumed dead (process killed mid-sync). */
const IN_FLIGHT_MS = 60 * 60 * 1000;

export type SyncTrigger = "cron" | "manual" | "startup" | "script";

let isSyncRunning = false;

export function isFullSyncRunning() {
    return isSyncRunning;
}

export async function runFullSync(daysBack = MAX_DAYS_BACK, trigger: SyncTrigger = "manual") {
    if (isSyncRunning) {
        throw new AppError(409, "SYNC_IN_PROGRESS", "Sync is already running, try again later");
    }
    isSyncRunning = true;
    const run = await prisma.syncRun.create({data: {trigger}});
    try {
        const market = await syncMarketData(daysBack);
        const portfolios = await rebuildAllSnapshots();
        // Yahoo has no IV history, so today's front-month ATM straddle is the
        // only chance to record it. Upserts by session, so a manual sync
        // during US hours is overwritten by the closing marks next morning.
        const implied = await captureImpliedSnapshots(await getTrackedSymbols());
        const factors = await refreshFactorsIfStale();
        await prisma.syncRun.update({where: {id: run.id}, data: {finishedAt: new Date(), ok: true}});
        return {...market, portfolios, impliedSnapshots: implied.recorded, factorsThrough: factors.through};
    } catch (err) {
        await prisma.syncRun
            .update({
                where: {id: run.id},
                data: {finishedAt: new Date(), error: err instanceof Error ? err.message.slice(0, 500) : String(err)},
            })
            .catch(() => undefined);
        throw err;
    } finally {
        isSyncRunning = false;
    }
}

/** Days of prices to refetch so the gap since the last good sync is covered, with a week of overlap. */
async function catchUpDaysBack(lastOk: Date | null): Promise<number> {
    let since = lastOk;
    if (!since) {
        const latest = await prisma.dailyPrice.findFirst({orderBy: {date: "desc"}, select: {date: true}});
        since = latest?.date ?? null;
    }
    if (!since) return MAX_DAYS_BACK;
    const days = Math.ceil((Date.now() - since.getTime()) / DAY_MS) + MIN_DAYS_BACK;
    return Math.min(MAX_DAYS_BACK, Math.max(MIN_DAYS_BACK, days));
}

/**
 * Runs a sync when no successful one has finished since the last US close.
 * Option chains cannot be fetched after the fact, so every session this skips
 * is a permanent gap in the implied-vol history.
 */
export async function catchUpIfStale(trigger: SyncTrigger, now = new Date()) {
    if (isSyncRunning) return {ran: false as const, reason: "a sync is already running"};
    // The flag above is per process; the API and the launchd script share only the table.
    const inFlight = await prisma.syncRun.findFirst({
        where: {finishedAt: null, startedAt: {gte: new Date(now.getTime() - IN_FLIGHT_MS)}},
        select: {startedAt: true},
    });
    if (inFlight) {
        return {ran: false as const, reason: `another process started a sync at ${inFlight.startedAt.toISOString()}`};
    }
    const lastOk = await prisma.syncRun.findFirst({
        where: {ok: true},
        orderBy: {finishedAt: "desc"},
        select: {finishedAt: true},
    });
    const close = latestUsSessionClose(now);
    if (lastOk?.finishedAt && lastOk.finishedAt >= close) {
        return {ran: false as const, reason: `last sync finished ${lastOk.finishedAt.toISOString()}, after the ${close.toISOString()} close`};
    }
    const daysBack = await catchUpDaysBack(lastOk?.finishedAt ?? null);
    const result = await runFullSync(daysBack, trigger);
    return {ran: true as const, daysBack, result};
}

// 6:30am MYT, Tue–Sat — after US market close (4–5am MYT).
// Daily sync only needs 7 days back (covers long weekends), not 400.
export function scheduleDailySync() {
    cron.schedule(
        "30 6 * * 2-6",
        async () => {
            try {
                const result = await runFullSync(MIN_DAYS_BACK, "cron");
                console.log("[sync] Daily sync completed successfully", result);
            } catch (err) {
                console.error("[sync] Daily sync failed", err);
            }
        },
        {timezone: "Asia/Kuala_Lumpur"}
    );
}
