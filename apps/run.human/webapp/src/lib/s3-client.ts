import { S3Client } from "@aws-sdk/client-s3";

// S3 client for user uploads - uses presigner IAM credentials
export const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.S3_UPLOADS_ACCESS_KEY!,
    secretAccessKey: process.env.S3_UPLOADS_SECRET_KEY!,
  },
  region: process.env.S3_UPLOADS_REGION || "us-east-1",
});

export const S3_UPLOADS_BUCKET = process.env.S3_UPLOADS_BUCKET!;
export const S3_UPLOADS_REGION = process.env.S3_UPLOADS_REGION || "us-east-1";

// Upload type configurations with size limits
export const UPLOAD_TYPES = {
  gpx: {
    maxSize: 5 * 1024 * 1024, // 5MB
    contentTypes: ["application/gpx+xml", "text/xml", "application/xml"],
    extension: "gpx",
  },
  photo: {
    maxSize: 20 * 1024 * 1024, // 20MB
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
    extension: "jpg", // Default extension for photos
  },
} as const;

export type UploadType = keyof typeof UPLOAD_TYPES;

export function isValidUploadType(type: string): type is UploadType {
  return type in UPLOAD_TYPES;
}
