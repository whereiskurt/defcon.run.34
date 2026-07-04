import { NextResponse } from "next/server";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3ClientForPresign } from "@/lib/s3-client";
import { GpxFolder } from "@/entities/gpx-folder";
import { GpxFile, GpxFileItem } from "@/entities/gpx-file";
import { fetchRouteMeta } from "@/lib/strapi";

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
};

export async function GET() {
  try {
    // CMS-curated metadata keyed by gpxFileId (matched against fileId OR filename
    // below). Best-effort — an empty map just means routes show filename + GPX meta.
    const cmsMeta = await fetchRouteMeta();

    // All GLOBAL folders (curated public collections). Every folder under the
    // "GLOBAL" partition is global by construction, but filter defensively.
    const folderResult = await GpxFolder.query.byUser({ userId: "GLOBAL" }).go();
    const globalFolders = folderResult.data.filter((f) => f.isGlobal);

    const groups = await Promise.all(
      globalFolders.map(async (folder) => {
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

            const cms = cmsMeta.get(file.fileId) ?? cmsMeta.get(file.fileName);
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
            };
          })
        );

        return {
          folderId: folder.folderId,
          folderName: folder.folderName,
          mapCount: maps.length,
          maps,
        };
      })
    );

    // Only surface folders that actually have maps to show.
    const nonEmptyGroups = groups.filter((g) => g.mapCount > 0);

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
