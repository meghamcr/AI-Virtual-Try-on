import { Queue } from "bullmq";
import { redisConnection } from "./config";
export const queue = new Queue("tryon", { connection: redisConnection });
export const enqueue = (id: string) =>
  queue.add(
    "generate",
    { id },
    {
      jobId: id,
      attempts: 1,
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
    },
  );
