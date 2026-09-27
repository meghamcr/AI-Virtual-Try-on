import "dotenv/config";
import { z } from "zod";
export const env = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z
      .string()
      .default("postgresql://tryon:tryon_local_only@localhost:55432/tryon"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    S3_ENDPOINT: z.string().default("http://localhost:9000"),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().default("tryon-private"),
    S3_ACCESS_KEY: z.string().default("tryon_local"),
    S3_SECRET_KEY: z.string().default("tryon_local_secret_change_me"),
    CORS_ORIGINS: z.string().default("http://localhost:5173"),
    PROVIDER: z.enum(["fashn", "mock"]).default("fashn"),
    FASHN_API_KEY: z.string().optional(),
    ENABLE_LIFESTYLE: z.string().default("false"),
    TRUST_PROXY: z.coerce.number().default(0),
  })
  .parse(process.env);
if (
  env.NODE_ENV === "production" &&
  (env.PROVIDER === "mock" ||
    !env.FASHN_API_KEY ||
    env.S3_SECRET_KEY.includes("change_me") ||
    env.S3_ENDPOINT.startsWith("http:"))
)
  throw Error(
    "Production requires real provider credentials, HTTPS storage and non-default storage secrets",
  );
export const redisConnection = (() => {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number(u.pathname.slice(1) || 0),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
  };
})();
