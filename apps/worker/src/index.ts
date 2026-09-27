import { Worker } from "bullmq";
import { redisConnection } from "../../api/src/config";
import { db } from "../../api/src/db";
import { queue, enqueue } from "../../api/src/queue";
import { processJob, collectGarbage } from "./processor";
import { terminal } from "../../../packages/shared/src/index";
const worker = new Worker("tryon", async (job) => processJob(job.data.id), {
  connection: redisConnection,
  concurrency: 2,
  maxStalledCount: 2,
});
worker.on("error", () =>
  console.error("Worker connection error; reconnecting."),
);
worker.on("failed", async (job) => {
  if (job)
    await db.tryOnJob.updateMany({
      where: { id: job.data.id, status: { notIn: terminal } },
      data: { status: "failed", errorCode: "WORKER_INTERRUPTED" },
    });
});
let sweeping = false;
async function reconcile() {
  if (sweeping) return;
  sweeping = true;
  try {
    await (
      await queue.client
    ).set("tryon:worker:heartbeat", String(Date.now()));
    for (const j of await db.tryOnJob.findMany({
      where: { status: { notIn: terminal } },
      take: 100,
    })) {
      const task = await queue.getJob(j.id);
      if (!task) await enqueue(j.id);
    }
    await collectGarbage();
  } catch {
    console.error("Reconciliation unavailable; will retry.");
  } finally {
    sweeping = false;
  }
}
const timer = setInterval(reconcile, 15000);
void reconcile();
console.log("TryOn Studio worker ready.");
async function stop() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
