/**
 * Manual month-end pass of the forecasting agents. Records forecasts for the
 * latest complete month; skips agents that already succeeded for it.
 *
 * Usage: npm run agents:run
 */
import {prisma} from "../src/lib/prisma";
import {runAgents} from "../src/services/agents.service";

async function main() {
    const outcome = await runAgents("script");
    console.log(outcome.ran ? outcome : `Skipped: ${outcome.reason}`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
