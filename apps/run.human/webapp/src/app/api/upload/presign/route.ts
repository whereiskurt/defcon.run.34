import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

import { auth } from "@/config/auth";
import {
  s3Client,
  S3_UPLOADS_BUCKET,
  S3_UPLOADS_REGION,
  UPLOAD_TYPES,
  isValidUploadType,
  type UploadType,
} from "@/lib/s3-client";
import { createUpload } from "@/entities/user-upload";
import {
  tryConsumeQuota,
  quotaExceededResponse,
  handleQuotaError,
  getUserTier,
  type QuotaId,
  type QuotaErrorResponse,
} from "@/lib/quota-middleware";
import { restoreQuota } from "@/lib/quota-client";

// URL expiration time in seconds (1 hour)
const PRESIGN_EXPIRES_IN = 3600;

interface QuotaInfo {
  fileUploadRemaining: number;
  typeUploadRemaining: number;
}

interface PresignResponse {
  uploadUrl: string;
  key: string;
  uploadId: string;
  bucket: string;
  region: string;
  expiresIn: number;
  maxSize: number;
  contentTypes: string[];
  uploadType: UploadType;
  quotaInfo: QuotaInfo;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

/**
 * GET /api/upload/presign
 *
 * Generate a presigned URL for uploading files to S3.
 * Requires authentication.
 *
 * Query parameters:
 *   - type: "gpx" | "photo" (required)
 *   - filename: Original filename (optional, for tracking)
 *   - contentType: MIME type (optional, defaults based on type)
 *
 * Returns:
 *   - uploadUrl: Presigned PUT URL for direct browser upload
 *   - key: S3 object key
 *   - uploadId: UUID for tracking the upload
 *   - bucket: S3 bucket name
 *   - region: S3 bucket region
 *   - expiresIn: Seconds until URL expires
 *   - maxSize: Maximum file size in bytes
 *   - contentTypes: Allowed content types
 */
export async function GET(request: NextRequest): Promise<NextResponse<PresignResponse | ErrorResponse | QuotaErrorResponse>> {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", details: "You must be logged in to upload files" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const filename = searchParams.get("filename");
    const contentType = searchParams.get("contentType");

    // Validate upload type
    if (!type || !isValidUploadType(type)) {
      return NextResponse.json(
        {
          error: "Invalid upload type",
          details: `Upload type must be one of: ${Object.keys(UPLOAD_TYPES).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const uploadConfig = UPLOAD_TYPES[type];

    // Determine user's quota tier from their services
    const userServices = session.user.services ?? [];
    const userTier = getUserTier(userServices);

    // Determine which quota to consume based on upload type
    const typeQuotaId: QuotaId = type === "gpx" ? "gpx_upload" : "photo_upload";

    // Consume general file_upload quota first (with tier for initialization)
    const fileQuotaResult = await tryConsumeQuota(userId, "file_upload", 1, userTier);
    if (!fileQuotaResult.success) {
      return quotaExceededResponse("file_upload", fileQuotaResult.remaining, 1);
    }

    // Consume type-specific quota
    const typeQuotaResult = await tryConsumeQuota(userId, typeQuotaId, 1, userTier);
    if (!typeQuotaResult.success) {
      // Rollback the file_upload quota we already consumed
      await restoreQuota(userId, "file_upload", 1);
      return quotaExceededResponse(typeQuotaId, typeQuotaResult.remaining, 1);
    }

    // Validate content type if provided
    const allowedContentTypes = uploadConfig.contentTypes as readonly string[];
    if (contentType && !allowedContentTypes.includes(contentType)) {
      // Restore consumed quotas on validation failure
      await restoreQuota(userId, "file_upload", 1);
      await restoreQuota(userId, typeQuotaId, 1);
      return NextResponse.json(
        {
          error: "Invalid content type",
          details: `Content type must be one of: ${uploadConfig.contentTypes.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Generate unique upload ID and S3 key
    const uploadId = randomUUID();
    const extension = uploadConfig.extension;
    const key = `uploads/${userId}/${type}/${uploadId}.${extension}`;

    // Determine content type for the presigned URL
    const finalContentType = contentType || uploadConfig.contentTypes[0];

    // Create the PutObject command
    const command = new PutObjectCommand({
      Bucket: S3_UPLOADS_BUCKET,
      Key: key,
      ContentType: finalContentType,
      // Add tagging for user isolation
      Tagging: `owner=${encodeURIComponent(userId)}&type=${type}`,
    });

    // Generate presigned URL
    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGN_EXPIRES_IN,
    });

    // Create the upload record in DynamoDB with status="pending"
    await createUpload(userId, uploadId, type, S3_UPLOADS_BUCKET, key, filename || undefined);

    // Return the presigned URL and metadata with quota info
    const response: PresignResponse = {
      uploadUrl,
      key,
      uploadId,
      bucket: S3_UPLOADS_BUCKET,
      region: S3_UPLOADS_REGION,
      expiresIn: PRESIGN_EXPIRES_IN,
      maxSize: uploadConfig.maxSize,
      contentTypes: [...uploadConfig.contentTypes],
      uploadType: type,
      quotaInfo: {
        fileUploadRemaining: fileQuotaResult.remaining,
        typeUploadRemaining: typeQuotaResult.remaining,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    // Handle quota errors specifically
    const quotaError = handleQuotaError(error);
    if (quotaError) return quotaError;

    console.error("[presign] Error generating presigned URL:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
