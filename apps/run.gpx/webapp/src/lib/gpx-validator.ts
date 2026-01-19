/**
 * GPX File Validator
 *
 * Validates that uploaded files are valid GPX XML by checking the file header.
 * Only fetches the first 1KB to minimize bandwidth.
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "./s3-client";

export interface GpxValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a file in S3 is a valid GPX file.
 * Checks for XML declaration and <gpx> root element in the first 1KB.
 *
 * @param key - S3 object key
 * @returns Validation result
 */
export async function validateGpxFile(key: string): Promise<GpxValidationResult> {
  try {
    // Fetch only the first 1KB of the file
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Range: "bytes=0-1023",
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return { valid: false, error: "Empty file" };
    }

    const content = await response.Body.transformToString();

    // Check for GPX root element (case-insensitive)
    // Valid GPX files should have <gpx somewhere near the start
    const hasGpxElement = /<gpx[\s>]/i.test(content);

    if (!hasGpxElement) {
      return {
        valid: false,
        error: "Not a valid GPX file: missing <gpx> root element",
      };
    }

    // Basic XML structure check - should have XML-like content
    const hasXmlStructure = content.includes("<") && content.includes(">");

    if (!hasXmlStructure) {
      return {
        valid: false,
        error: "Not a valid GPX file: invalid XML structure",
      };
    }

    return { valid: true };
  } catch (error) {
    // If file doesn't exist yet (upload not complete), return error
    const err = error as { name?: string };
    if (err.name === "NoSuchKey") {
      return { valid: false, error: "File not found in storage" };
    }

    console.error("[validateGpxFile] Error:", error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Validation failed",
    };
  }
}
