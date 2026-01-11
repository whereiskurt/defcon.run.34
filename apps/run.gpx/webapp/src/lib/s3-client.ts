import { S3Client } from "@aws-sdk/client-s3";

const isDev = process.env.NODE_ENV !== "production";

export const s3Client = new S3Client({
  region: process.env.S3_UPLOADS_REGION || "us-east-1",
  ...(isDev && process.env.S3_UPLOADS_ENDPOINT
    ? { endpoint: process.env.S3_UPLOADS_ENDPOINT, forcePathStyle: true }
    : {}),
  credentials: {
    accessKeyId: process.env.S3_UPLOADS_ACCESS_KEY!,
    secretAccessKey: process.env.S3_UPLOADS_SECRET_KEY!,
  },
});

export const BUCKET = process.env.S3_UPLOADS_BUCKET!;

/**
 * Get the S3 key prefix for a user's GPX files
 */
export function getUserPrefix(userId: string): string {
  return `uploads/${userId}/gpx/`;
}
