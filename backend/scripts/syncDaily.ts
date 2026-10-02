/**
 * Daily sync without the API running, for launchd or cron.
 *
 * Skips when a sync has already finished after the last US close, so it is
 * safe to schedule alongside the API's own 6:30am job. `--force` always runs.
 *
 * Usage: npm run sync:daily [-- --force]
 */
import {prisma} from "../src/lib/prisma";
import {catchUpIfStale, runFullSync} from "../src/jobs/sync.job";

async function main() {
    if (process.argv.includes("--force")) {
        console.log(await runFullSync(7, "script"));
        return;
    }
    const outcome = await catchUpIfStale("script");
    console.log(outcome.ran ? outcome.result : `Skipped: ${outcome.reason}`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
