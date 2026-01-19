/**
 * GPX File Validator
 *
 * Validates that uploaded files are valid GPX XML by checking:
 * 1. No binary content (magic bytes, null bytes, non-text characters)
 * 2. Valid XML structure with <gpx> root element
 *
 * Only fetches the first 1KB to minimize bandwidth.
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "./s3-client";

export interface GpxValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Common binary file magic bytes (first 2-4 bytes)
 * These indicate non-text file formats that should be rejected.
 */
const BINARY_MAGIC_BYTES: Array<{ name: string; bytes: number[] }> = [
  { name: "PNG", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: "JPEG", bytes: [0xff, 0xd8, 0xff] },
  { name: "GIF", bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "PDF", bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: "ZIP", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: "GZIP", bytes: [0x1f, 0x8b] },
  { name: "EXE/DLL", bytes: [0x4d, 0x5a] },
  { name: "ELF", bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: "RAR", bytes: [0x52, 0x61, 0x72, 0x21] },
  { name: "7Z", bytes: [0x37, 0x7a, 0xbc, 0xaf] },
  { name: "WEBP", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
  { name: "MP3", bytes: [0x49, 0x44, 0x33] }, // ID3
  { name: "MP4", bytes: [0x00, 0x00, 0x00] }, // ftyp box (varies)
  { name: "WASM", bytes: [0x00, 0x61, 0x73, 0x6d] },
];

/**
 * Check if a byte array starts with known binary magic bytes
 */
function hasBinaryMagicBytes(bytes: Uint8Array): string | null {
  for (const magic of BINARY_MAGIC_BYTES) {
    if (bytes.length >= magic.bytes.length) {
      const matches = magic.bytes.every((b, i) => bytes[i] === b);
      if (matches) {
        return magic.name;
      }
    }
  }
  return null;
}

/**
 * Check if content contains binary (non-text) data.
 * Text files should only contain printable ASCII, tabs, newlines, and valid UTF-8.
 *
 * Returns true if binary content is detected.
 */
function containsBinaryContent(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];

    // Null byte - definite binary indicator
    if (byte === 0x00) {
      return true;
    }

    // Control characters (except tab, newline, carriage return)
    // 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F
    if (byte < 0x09 || byte === 0x0b || byte === 0x0c || (byte >= 0x0e && byte < 0x20)) {
      return true;
    }

    // DEL character
    if (byte === 0x7f) {
      return true;
    }
  }

  return false;
}

/**
 * Validate that a file in S3 is a valid GPX file.
 *
 * Validation steps:
 * 1. Check for binary magic bytes (PNG, JPEG, ZIP, etc.)
 * 2. Check for any binary/non-text content
 * 3. Verify <gpx> root element exists
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

    // Get raw bytes for binary detection
    const bytes = await response.Body.transformToByteArray();

    if (bytes.length === 0) {
      return { valid: false, error: "Empty file" };
    }

    // Check for known binary file formats
    const binaryFormat = hasBinaryMagicBytes(bytes);
    if (binaryFormat) {
      return {
        valid: false,
        error: `Binary file detected: ${binaryFormat} format is not allowed`,
      };
    }

    // Check for any binary content
    if (containsBinaryContent(bytes)) {
      return {
        valid: false,
        error: "Binary content detected: file must be valid XML text",
      };
    }

    // Convert to string for XML checks
    const content = new TextDecoder().decode(bytes);

    // Check for GPX root element (case-insensitive)
    const hasGpxElement = /<gpx[\s>]/i.test(content);

    if (!hasGpxElement) {
      return {
        valid: false,
        error: "Not a valid GPX file: missing <gpx> root element",
      };
    }

    // Basic XML structure check
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
