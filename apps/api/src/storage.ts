import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { env } from "./config";
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  maxAttempts: 2,
  requestHandler: { requestTimeout: 20000, connectionTimeout: 3000 },
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});
export const put = async (key: string, body: Buffer) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/jpeg",
    }),
  );
};
export const get = async (key: string) =>
  Buffer.from(
    await (
      await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    ).Body!.transformToByteArray(),
  );
export const remove = async (key: string) => {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
};
export const storageReady = () =>
  s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
export async function initStorage() {
  try {
    await storageReady();
  } catch (e) {
    if (
      (e as { $metadata?: { httpStatusCode: number } }).$metadata
        ?.httpStatusCode !== 404
    )
      throw e;
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}
