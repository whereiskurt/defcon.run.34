import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { nanoid } from "nanoid";
import { GpxFile } from "@/entities/gpx-file";
import { Route } from "@/entities/route";
import { GpxShare } from "@/entities/gpx-share";
import { s3Client, BUCKET, getRouteKey } from "@/lib/s3-client";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { sanitizeCardText } from "@/lib/route-card";
import { isRouteCapped, isPublishCapped } from "@/lib/route-caps";
import { isShareState, canGoPublic, type ShareState } from "@/lib/share-state";
import { buildShareUrl } from "@/lib/share-url";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/gpx/files/[id]/visibility — the single share transition for a route
 * (2026-08-01 unified-routes spec).
 *
 * Body: { state: "private" | "link" | "public" }
 *
 * This is orchestration, not new sharing machinery: it composes the same
 * primitives the standalone endpoints use (Route mint + publish/unpublish,
 * GpxShare token mint/revoke, the convert-public compliance copy). The
 * standalone /routes/[id]/publish|unpublish endpoints stay, because orphan
 * Route rows have no backing GpxFile to address here.
 *
 * The three states are EXCLUSIVE. Every transition tears the others down, so a
 * route can never be simultaneously link-shared and map-published — which is
 * the whole point of collapsing four verbs into one control.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Live lock-out check at the write boundary: a locked identity is blocked
  // immediately, not after the ~5-min session re-validation.
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { id } = await params;
  const userId = session.user.id;

  let state: ShareState;
  try {
    const body = await request.json();
    if (!isShareState(body?.state)) {
      return NextResponse.json(
        { error: "state must be 'private', 'link' or 'public'" },
        { status: 400 }
      );
    }
    state = body.state;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // Ownership. 404 (not 403) on a miss — non-disclosure posture.
    const fileResult = await GpxFile.get({ userId, fileId: id }).go();
    const file = fileResult.data;
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Publishing is gated before anything is torn down, so a rejected transition
    // leaves the route exactly as it was.
    const eligibility = canGoPublic(file);
    if (state === "public" && !eligibility.ok && eligibility.reason === "inactive") {
      return NextResponse.json(
        { error: "Only a fully uploaded route can be shared" },
        { status: 400 }
      );
    }

    // Resolve the currently linked Route, if any. A row that vanished, or that
    // somehow is not ours, is treated as absent so a file can always be
    // repaired back into a coherent state.
    const linkedId = file.publishedRouteId;
    let linked: { routeId: string } | null = null;
    if (linkedId) {
      const got = await Route.get({ routeId: linkedId }).go();
      if (got.data && got.data.ownerId === userId) {
        linked = got.data as { routeId: string };
      }
    }

    if (state === "public") {
      const mine = await Route.query
        .byOwner({ ownerId: userId })
        .go({ pages: "all" });
      const isAdmin = services.includes("admin");
      const owned = (mine.data ?? []).filter((r) => r.status !== "failed");
      const publishedCount = owned.filter(
        (r) => r.visibility === "published" && r.routeId !== linkedId
      ).length;
      if (isPublishCapped(publishedCount, isAdmin)) {
        return NextResponse.json(
          { error: "Published route limit reached" },
          { status: 429 }
        );
      }
      if (!linked && isRouteCapped(owned.length, isAdmin)) {
        return NextResponse.json(
          { error: "Route limit reached" },
          { status: 429 }
        );
      }
    }

    // --- Tear down link shares. Every state either wants them gone (private,
    // public) or wants a fresh one (link). ---
    const existingShares = await GpxShare.query
      .byFile({ ownerId: userId, fileId: id })
      .go({ pages: "all" });
    for (const share of existingShares.data ?? []) {
      await GpxShare.delete({ shareId: share.shareId }).go();
    }

    if (state === "link") {
      const shareId = nanoid(21);
      await GpxShare.create({
        shareId,
        ownerId: userId,
        fileId: id,
        version: file.version ?? 1,
        accessMode: "public",
      }).go();

      logEvent("gpx.share.link", {
        headers: request.headers,
        userId,
        email: session.user.email ?? undefined,
        meta: { fileId: id },
      });

      return NextResponse.json({ state, shareUrl: buildShareUrl(shareId) });
    }

    if (state === "private") {
      if (linked) {
        await Route.update({ routeId: linked.routeId })
          .set({ visibility: "private" })
          .go();
        // publishedAt is byVisibility's sk: removing it drops the row out of the
        // community index entirely rather than merely filtering it out.
        await Route.update({ routeId: linked.routeId })
          .remove(["publishedAt"])
          .go();
      }
      if (linkedId) {
        await GpxFile.update({ userId, fileId: id })
          .remove(["publishedRouteId"])
          .go();
      }

      logEvent("gpx.share.private", {
        headers: request.headers,
        userId,
        email: session.user.email ?? undefined,
        meta: { fileId: id, routeId: linkedId },
      });

      return NextResponse.json({ state, routeId: linkedId });
    }

    // --- state === "public" ---
    // `needs-conversion` is NOT an error. The spec makes convert-public
    // automatic: the route is minted as a `converted` copy — exactly what
    // /files/[id]/convert-public produces — and the raw import is never itself
    // published. stravaActivityId is deliberately not carried across.
    const routeId = linked?.routeId ?? uuidv4();
    const key = getRouteKey(routeId);
    const now = Date.now();

    // Server-side copy: the browser never re-uploads, and the public object is a
    // distinct key with no user identifier in its path (presigned URLs expose
    // the key, so this is a disclosure boundary, not just tidiness).
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURI(`${file.bucket}/${file.key}`),
        Key: key,
      })
    );

    const metrics = {
      fileSize: file.fileSize,
      trackCount: file.trackCount,
      waypointCount: file.waypointCount,
      totalDistance: file.totalDistance,
      totalElevation: file.totalElevation,
      bounds: file.bounds,
    };

    if (linked) {
      await Route.update({ routeId })
        .set({ ...metrics, visibility: "published", publishedAt: now })
        .go();
    } else {
      await Route.create({
        routeId,
        ownerId: userId,
        name:
          sanitizeCardText(file.fileName.replace(/\.gpx$/i, "")).slice(0, 80) ||
          "Untitled route",
        bucket: BUCKET,
        key,
        ...metrics,
        status: "active",
        visibility: "published",
        publishedAt: now,
        source: "converted",
        sourceGpxFileId: id,
        createdByName:
          sanitizeCardText(session.user.name ?? "").slice(0, 80) || undefined,
      }).go();

      await GpxFile.update({ userId, fileId: id })
        .set({ publishedRouteId: routeId })
        .go();
    }

    logEvent("gpx.share.public", {
      headers: request.headers,
      userId,
      email: session.user.email ?? undefined,
      meta: { fileId: id, routeId, converted: !eligibility.ok },
    });

    return NextResponse.json({ state, routeId });
  } catch (error) {
    console.error("Error updating visibility:", error);
    return NextResponse.json(
      { error: "Failed to update sharing" },
      { status: 500 }
    );
  }
}
