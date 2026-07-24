import appsManifest from "@/../public/data/apps-manifest.json";

/** Base path for mirrored phone-app installers. Served from S3 via CloudFront
 *  in production (asset prefix), locally from public/apps/ in dev. */
export const APPS_BASE_PATH = process.env.NEXT_PUBLIC_ASSET_PREFIX
  ? `${process.env.NEXT_PUBLIC_ASSET_PREFIX}/apps`
  : "/apps";

export interface AppDownloadEntry {
  id: string;
  kind: "apk" | "store";
  label: string;
  sublabel: string;
  filename?: string;
  storeUrl?: string;
}

export const APP_DOWNLOADS: AppDownloadEntry[] =
  appsManifest.apps as AppDownloadEntry[];

export function getAppHref(entry: AppDownloadEntry): string {
  if (entry.kind === "store") return entry.storeUrl ?? "#";
  return `${APPS_BASE_PATH}/${entry.filename}`;
}
