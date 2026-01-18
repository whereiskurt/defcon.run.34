/**
 * API URL helper for client-side fetch calls
 *
 * In production, Next.js uses basePath (e.g., /use1) which means
 * API routes are at /{region}/api/... not /api/...
 *
 * This helper ensures API calls include the basePath when needed.
 */

const REGION_SHORT = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Get the API base path for client-side requests
 * Returns empty string in dev, /{region} in production
 */
export function getApiBasePath(): string {
  return IS_PRODUCTION ? `/${REGION_SHORT}` : "";
}

/**
 * Build a full API URL with the correct basePath
 * @param path - API path starting with /api/... (e.g., "/api/user")
 * @returns Full URL with basePath in production (e.g., "/use1/api/user")
 */
export function apiUrl(path: string): string {
  const basePath = getApiBasePath();
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}
