import { app } from "./app";
import { env } from "./config/env";
import { scheduleDailySync } from "./jobs/sync.job";

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  scheduleDailySync();
});