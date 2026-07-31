import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "@/lib/s3-client";
import {
  isHeatmapYear,
  heatmapArtifactKey,
  assertNonAttributable,
  type HeatmapArtifact,
} from "@/lib/heatmap-artifact";

/**
 * GET /api/gpx/public/heatmap/[year] — the SECOND public, UNAUTHENTICATED,
 * NON-ATTRIBUTABLE surface in this app (Phase 71, HEAT-01; implements D-09).
 * The first is `/api/gpx/public/aggregate`; see its module comment for how the
 * two relate and why the older "only public surface" claim no longer holds.
 *
 * Unlike the aggregate route, this one serves a PRECOMPUTED S3 artifact instead
 * of scanning DynamoDB per request — exactly the migration the aggregate
 * route's own NOTE recommends. The builder (`lib/heatmap-build.ts` for DC34,
 * the one-off backfill for DC33) writes the object; this route only reads it.
 *
 * Every feature in that object is BARE GEOMETRY with zero properties — no
 * name, no id, no user, no timestamp — produced and then structurally verified
 * by `assertNonAttributable()` in `lib/heatmap-artifact.ts`, which is the
 * compensating control for sourcing runs without an owner opt-in gate. This
 * route runs that same guard on the way OUT as well; see the call site.
 *
 * `?meta=1` — EXACTLY the string `1`, nothing else is truthy here — projects
 * the artifact's `meta` block alone (a few hundred bytes) so the studio can
 * render availability and the "last calculated" stamp without paying for
 * geometry it may never show. Any other value, including `0`, returns the full
 * artifact.
 *
 * CACHING — where it actually comes from. An earlier version of this comment
 * claimed each distinct query value was its own CDN cache entry. That was not
 * true when it was written: the catch-all region behaviour on this distribution
 * uses the managed caching-DISABLED policy, so the `s-maxage` header below was
 * ignored at the edge and three consecutive identical requests all missed to
 * origin. The caching is delivered by a DEDICATED ordered cache behaviour for
 * this path in `infra/terraform/modules/cloudfront/v1.0.0/main.tf`, added by
 * plan 71-13, whose cache key whitelists exactly the `meta` query string. If
 * that behaviour is removed the header becomes decorative again and every hit
 * is an origin S3 read plus a full-artifact response body off a single ECS task.
 *
 * There is deliberately no session lookup and no cookie read here — that
 * absence is the whole of what makes this route public, and it is also why a
 * shared CDN entry cannot leak per-user variation.
 */

// Longer than the aggregate route's 600: that route recomputes on demand, this
// one hands back an object that is rebuilt at most hourly, so a staler edge
// copy costs nothing in freshness. This header only BUYS anything while the
// dedicated cloudfront ordered cache behaviour from plan 71-13 exists — the
// catch-all region behaviour uses the managed caching-disabled policy and
// ignores it entirely.
const CACHE_SECONDS = 900;

const CACHE_HEADERS = {
  "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
};

interface RouteParams {
  params: Promise<{ year: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { year } = await params;

    // Allowlist FIRST, before anything else touches the segment. The raw value
    // is never concatenated into an S3 key, a URL or a log line — it reaches
    // the key helper below only after being narrowed to a `HeatmapYear`, so
    // path traversal and bucket enumeration are structurally impossible rather
    // than filtered out after the fact.
    if (!isHeatmapYear(year)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: string | undefined;
    try {
      const obj = await s3Client.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: heatmapArtifactKey(year) })
      );
      body = await obj.Body?.transformToString();
    } catch (error) {
      // An unbuilt or deleted year reads as absent to the studio, which then
      // simply hides the row. 404 is the honest code and it pages nobody.
      //
      // WARN, not ERROR: this path is unauthenticated, so an outsider looping
      // on an unbuilt year could otherwise drive CloudWatch error volume — and
      // any alarm built on it — at will.
      //
      // NEVER pass the caught object itself. Node's console inspects enumerable
      // own properties, and S3 exceptions carry request ids, response metadata
      // and for several shapes the bucket name and the key. Logging the whole
      // thing is exactly how a per-user `uploads/{userId}/...` key leaks the
      // next time this file is copied. A name is enough to triage.
      console.warn(
        `[heatmap] artifact unavailable for ${year}:`,
        error instanceof Error ? error.name : "unknown-error"
      );
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!body) {
      console.warn(`[heatmap] artifact object for ${year} had an empty body`);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let artifact: HeatmapArtifact;
    try {
      artifact = JSON.parse(body) as HeatmapArtifact;
    } catch {
      // A corrupt object is a server-side problem, not a missing one. The
      // parse error's message quotes the offending bytes, so it is not logged.
      console.error(`[heatmap] artifact for ${year} is not valid JSON`);
      return NextResponse.json(
        { error: "Failed to load heatmap" },
        { status: 500 }
      );
    }

    // WR-02 — prove the output, do not merely trust the writer.
    //
    // The `JSON.parse(...) as HeatmapArtifact` above is an ASSERTION, not a
    // check: until this call, the only thing standing between a bad object and
    // the open internet was the write-path guard in the two known builders. Any
    // write that bypasses them — a manual object copy during an incident, a
    // restore from backup, a future second builder, a compromised uploads
    // keypair — would be echoed unchecked. The cost is one structural walk per
    // ORIGIN request, which the dedicated cache behaviour reduces to a handful
    // per cache period.
    //
    // The guard's message names structural paths, so it is not echoed to the
    // caller and not logged; the year plus the fact of failure is what triage
    // needs, and a 500 is correct because the object exists and is wrong.
    try {
      assertNonAttributable(artifact);
    } catch {
      console.error(
        `[heatmap] artifact for ${year} failed the non-attributability guard — refusing to serve`
      );
      return NextResponse.json(
        { error: "Failed to load heatmap" },
        { status: 500 }
      );
    }

    // An object that parses to `{}` satisfies neither branch below: the meta
    // projection would return a 200 with an empty body and a JSON content type,
    // which the studio then fails to parse. (The guard above accepts `{}` only
    // if it somehow carried the right keys; this is the belt to that braces.)
    if (!artifact.meta || !Array.isArray(artifact.features)) {
      console.error(`[heatmap] artifact for ${year} is missing meta/features`);
      return NextResponse.json(
        { error: "Failed to load heatmap" },
        { status: 500 }
      );
    }

    // EXACT equality: `?meta=1` and nothing else. The old truthiness test made
    // `?meta=0` project meta, which is the opposite of what it reads as.
    if (new URL(request.url).searchParams.get("meta") === "1") {
      return NextResponse.json(artifact.meta, { headers: CACHE_HEADERS });
    }

    return NextResponse.json(artifact, { headers: CACHE_HEADERS });
  } catch (error) {
    // Never echo the S3 error, the bucket name or the key to the caller — and
    // never to the log either; see the read-failure handler above.
    console.error(
      "[heatmap] Error serving heatmap:",
      error instanceof Error ? error.name : "unknown-error"
    );
    return NextResponse.json(
      { error: "Failed to load heatmap" },
      { status: 500 }
    );
  }
}
