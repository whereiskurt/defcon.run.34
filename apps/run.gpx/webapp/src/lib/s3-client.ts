import { S3Client } from "@aws-sdk/client-s3";

const isDev = process.env.NODE_ENV !== "production";

const baseConfig = {
  region: process.env.S3_UPLOADS_REGION || "us-east-1",
  ...(isDev && process.env.S3_UPLOADS_ENDPOINT
    ? { endpoint: process.env.S3_UPLOADS_ENDPOINT, forcePathStyle: true }
    : {}),
  credentials: {
    accessKeyId: process.env.S3_UPLOADS_ACCESS_KEY!,
    secretAccessKey: process.env.S3_UPLOADS_SECRET_KEY!,
  },
};

// Standard S3 client for server-side operations
export const s3Client = new S3Client(baseConfig);

// S3 client for generating presigned URLs (no checksums for browser compatibility)
// The requestChecksumCalculation option prevents checksum headers in presigned URLs
// which would require the browser to calculate and send matching checksums
export const s3ClientForPresign = new S3Client({
  ...baseConfig,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const BUCKET = process.env.S3_UPLOADS_BUCKET!;

/**
 * Get the S3 key prefix for a user's GPX files
 */
export function getUserPrefix(userId: string): string {
  return `uploads/${userId}/gpx/`;
}

/**
 * S3 key for a Route template (routes-vs-runs spec). Deliberately contains NO
 * user identifier: presigned URLs expose the object key in their path, and
 * community/detail endpoints hand those URLs to other signed-in users — a key
 * of uploads/{ownerId}/... would leak the owner's OIDC sub (security review
 * finding, 2026-07-28). "ROUTES" is a reserved sentinel segment like GLOBAL;
 * routeId is a server-minted uuid, so keys are unguessable and never listed.
 */
export function getRouteKey(routeId: string): string {
  return `uploads/ROUTES/${routeId}.gpx`;
}
