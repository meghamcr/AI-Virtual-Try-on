import { app } from "./app";
import { env } from "./config";
import { db } from "./db";
import { queue } from "./queue";
const server = app.listen(env.PORT, "0.0.0.0", () =>
  console.log(
    `TryOn Studio API listening on ${env.PORT}; provider=${env.PROVIDER}`,
  ),
);
const stop = () =>
  server.close(() => {
    Promise.all([db.$disconnect(), queue.close()]).then(() => process.exit(0));
  });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
