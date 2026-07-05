import { NextResponse } from "next/server";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign } from "@/lib/s3-client";
import { GpxFolder } from "@/entities/gpx-folder";
import { GpxFile, GpxFileItem } from "@/entities/gpx-file";
import { fetchRouteMeta, type PoiMeta } from "@/lib/strapi";

/**
 * GET /api/gpx/public/maps - Public, UNAUTHENTICATED list of the DC34 official
 * map overlays.
 *
 * Returns every GLOBAL folder (e.g. "DEF CON 34 Maps", "Rabbit Routes") with its
 * active GPX files, each carrying a short-lived presigned download URL plus display
 * metadata. The studio renders each folder as a read-only, toggleable layer group
 * (group master toggle + per-route toggle).
 *
 * Only exposes `userId="GLOBAL"` folders and `status:"active"` files — a viewer's
 * own private routes are never surfaced here.
 */

const PRESIGN_TTL_SECONDS = 3600;
// Cache the manifest for a few minutes; must stay well under the presign TTL so
// handed-out URLs are always still valid when a client uses them.
const CACHE_SECONDS = 300;

type PublicMap = {
  fileId: string;
  fileName: string;
  title?: string;
  // CMS enrichment (all optional; matched by gpxFileId against fileId OR filename)
  shortDescription?: string;
  descriptionHtml?: string;
  distanceKm?: number;
  elevationM?: number;
  mapColor?: string;
  mapWeight?: number;
  mapOpacity?: number;
  coverImageUrl?: string;
  coverImageDisplayUrl?: string;
  stravaUrl?: string;
  downloadUrl: string;
  bounds?: GpxFileItem["bounds"];
  totalDistance?: number;
  totalElevation?: number;
  trackCount?: number;
  waypointCount?: number;
  uploadedBy?: string;
  tags?: string[];
  // Phase-3 seam: CMS points-of-interest attached to a route. Left unset in
  // Phase 2 (POI populate/attach is deferred).
  pois?: PoiMeta[];
};

type MapGroup = {
  folderId: string;
  folderName: string;
  maps: PublicMap[];
};

/** Lowercase + hyphenate a mapFolder name for a synthetic folderId. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET() {
  try {
    // CMS routes: `byGpxKey` enriches DynamoDB routes (matched against fileId OR
    // filename below); `cmsRoutes` drives standalone-route emission. Best-effort —
    // empty means routes show filename + GPX meta and no standalone CMS routes.
    const { byGpxKey, cmsRoutes } = await fetchRouteMeta();

    // POIs for enriched DynamoDB routes: keyed the same way as byGpxKey (a CMS
    // gpxFileId that is EITHER a fileId OR a filename), so a Dynamo route matched
    // by fileId/fileName also receives its CMS route's POIs. Only rows WITH a
    // gpxFileId land here; rows without one are standalone-only (handled below).
    const poisByGpxKey = new Map<string, PoiMeta[]>();
    for (const r of cmsRoutes) {
      if (r.gpxFileId) poisByGpxKey.set(r.gpxFileId, r.pois);
    }

    // All GLOBAL folders (curated public collections). Every folder under the
    // "GLOBAL" partition is global by construction, but filter defensively.
    const folderResult = await GpxFolder.query.byUser({ userId: "GLOBAL" }).go();
    const globalFolders = folderResult.data.filter((f) => f.isGlobal);

    const groups: MapGroup[] = await Promise.all(
      globalFolders.map(async (folder): Promise<MapGroup> => {
        const fileResult = await GpxFile.query
          .byFolder({ userId: "GLOBAL", folderId: folder.folderId })
          .go();

        const activeFiles = fileResult.data.filter(
          (file) => file.status === "active"
        );

        const maps: PublicMap[] = await Promise.all(
          activeFiles.map(async (file) => {
            const command = new GetObjectCommand({
              Bucket: file.bucket,
              Key: file.key,
            });
            const downloadUrl = await getSignedUrl(s3ClientForPresign, command, {
              expiresIn: PRESIGN_TTL_SECONDS,
            });

            const cms = byGpxKey.get(file.fileId) ?? byGpxKey.get(file.fileName);
            // Attach the CMS route's POIs to this enriched route (fileId OR
            // filename match, mirroring the enrichment join). Omit the field
            // entirely when there is no match or the array is empty.
            const pois =
              poisByGpxKey.get(file.fileId) ?? poisByGpxKey.get(file.fileName);
            return {
              fileId: file.fileId,
              fileName: file.fileName,
              title: cms?.title,
              shortDescription: cms?.shortDescription,
              descriptionHtml: cms?.descriptionHtml,
              distanceKm: cms?.distanceKm,
              elevationM: cms?.elevationM,
              mapColor: cms?.mapColor,
              mapWeight: cms?.mapWeight,
              mapOpacity: cms?.mapOpacity,
              coverImageUrl: cms?.coverImageUrl,
              coverImageDisplayUrl: cms?.coverImageDisplayUrl,
              stravaUrl: cms?.stravaUrl,
              downloadUrl,
              bounds: file.bounds,
              totalDistance: file.totalDistance,
              totalElevation: file.totalElevation,
              trackCount: file.trackCount,
              waypointCount: file.waypointCount,
              uploadedBy: file.uploadedBy,
              tags: file.tags ? Array.from(file.tags) : undefined,
              pois: pois && pois.length > 0 ? pois : undefined,
            };
          })
        );

        return {
          folderId: folder.folderId,
          folderName: folder.folderName,
          maps,
        };
      })
    );

    // ---- Standalone CMS routes (D1–D4) -------------------------------------
    // Collision set: every active DynamoDB fileId AND fileName across all groups
    // — the same identity space the enrichment join above matches against. A CMS
    // route whose gpxFileId is in here stays enrichment-only (DynamoDB wins, D2).
    const dynamoKeys = new Set<string>();
    for (const g of groups) {
      for (const m of g.maps) {
        dynamoKeys.add(m.fileId);
        dynamoKeys.add(m.fileName);
      }
    }

    // Track which groups received CMS routes so we can order just those entries.
    const cmsTouched = new Set<MapGroup>();

    for (const r of cmsRoutes) {
      if (!r.gpxUrl) continue; // orphan stub — no asset to render.
      // Collision → DynamoDB wins; the CMS record already enriched via byGpxKey.
      if (r.gpxFileId && dynamoKeys.has(r.gpxFileId)) continue;

      const map: PublicMap = {
        fileId: "cms-" + r.documentId, // namespaced; cannot collide with a UUID.
        fileName: r.gpxName ?? r.documentId,
        title: r.meta.title,
        shortDescription: r.meta.shortDescription,
        descriptionHtml: r.meta.descriptionHtml,
        distanceKm: r.meta.distanceKm,
        elevationM: r.meta.elevationM,
        mapColor: r.meta.mapColor,
        mapWeight: r.meta.mapWeight,
        mapOpacity: r.meta.mapOpacity,
        coverImageUrl: r.meta.coverImageUrl,
        coverImageDisplayUrl: r.meta.coverImageDisplayUrl,
        stravaUrl: r.meta.stravaUrl,
        // PUBLIC CMS media URL — NOT an S3-uploads object, so no presign.
        downloadUrl: r.gpxUrl,
        // bounds derived client-side (plan 02-03).
        // Attach the route's own POIs (same PoiMeta[] on the row); omit when empty.
        pois: r.pois.length > 0 ? r.pois : undefined,
      };

      // Fold into the group named by mapFolder — reuse the GLOBAL folder's
      // folderId when the name matches (D3), else synthesize a new group.
      let group = groups.find((g) => g.folderName === r.mapFolder);
      if (!group) {
        group = {
          folderId: "cms-folder-" + slug(r.mapFolder),
          folderName: r.mapFolder,
          maps: [],
        };
        groups.push(group);
      }
      group.maps.push(map);
      cmsTouched.add(group);
    }

    // Order CMS-emitted entries by ascending sortOrder within their group. CMS
    // routes are the ones with a `cms-` fileId prefix; DynamoDB maps keep their
    // existing relative order ahead of appended CMS routes.
    const cmsSortOrder = new Map<string, number>();
    for (const r of cmsRoutes) cmsSortOrder.set("cms-" + r.documentId, r.sortOrder ?? 0);
    for (const g of cmsTouched) {
      g.maps.sort((a, b) => {
        const aCms = a.fileId.startsWith("cms-");
        const bCms = b.fileId.startsWith("cms-");
        if (aCms && bCms) {
          return (cmsSortOrder.get(a.fileId) ?? 0) - (cmsSortOrder.get(b.fileId) ?? 0);
        }
        // Keep DynamoDB maps ahead of CMS-emitted ones in a shared group.
        return aCms ? 1 : bCms ? -1 : 0;
      });
    }

    // Empty-group drop AFTER merging standalone routes.
    const nonEmptyGroups = groups.filter((g) => g.maps.length > 0);

    return NextResponse.json(
      { groups: nonEmptyGroups },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (error) {
    console.error("Error listing public maps:", error);
    return NextResponse.json(
      { error: "Failed to list public maps" },
      { status: 500 }
    );
  }
}
