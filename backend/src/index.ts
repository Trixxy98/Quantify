import { app } from "./app";
import { env } from "./config/env";
import { catchUpIfStale, scheduleDailySync } from "./jobs/sync.job";

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  scheduleDailySync();
  catchUpIfStale("startup")
    .then((outcome) => {
      if (outcome.ran) console.log(`[sync] Caught up on startup (${outcome.daysBack} days back)`, outcome.result);
      else console.log(`[sync] No catch-up needed: ${outcome.reason}`);
    })
    .catch((err) => console.error("[sync] Startup catch-up failed", err));
});
