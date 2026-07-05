import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const UID = 'api::ui-string.ui-string';
const DEFAULT_LOCALE = 'default';

/**
 * FALL-01: regenerate the public copy.json fallback export and upload it to the
 * CMS media S3 bucket (served via CloudFront at
 * https://cms.${SITE_DOMAIN}/${REGION_SHORT}/cms/copy.json).
 *
 * Called from ui-string afterCreate/afterUpdate/afterDelete. Reads the FULL
 * catalog each call (not a diff) so deletes drop keys correctly. Guards:
 *   1. master-only (CMS_MODE === 'master') — workers never write.
 *   2. S3-env present — otherwise a graceful local no-op (never throws).
 * Exported bundle contains ONLY key → value; `notes` and every other attribute
 * are excluded (notes is an internal editor hint, not public copy).
 */
export async function regenerateAndUpload(strapi) {
  // Guard 1: master-only. Workers restore master's DB via Litestream and must
  // not write to S3.
  if (process.env.CMS_MODE !== 'master') {
    strapi.log.debug('[copy-export] not master — skipping copy.json export');
    return;
  }

  // Guard 2: S3 env present. Mirror the plugins.ts "use default local provider"
  // fallback so local dev never breaks.
  const bucket = process.env.S3_MEDIA_BUCKET;
  const accessKeyId = process.env.S3_MEDIA_ACCESS_KEY;
  const secretAccessKey = process.env.S3_MEDIA_SECRET_KEY;
  if (!bucket || !accessKeyId) {
    strapi.log.info('[copy-export] S3 env absent — skipping copy.json export');
    return;
  }

  try {
    // Read the full catalog; group into a locale-keyed map of key → value.
    // Only `default` is populated in v1, but we key off the row's locale so
    // future locales flow through untouched.
    const rows = await strapi.db.query(UID).findMany({
      where: {},
      limit: -1,
    });

    const bundle: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      const locale = row.locale || DEFAULT_LOCALE;
      const key = row.key;
      if (!key) continue;
      if (!bundle[locale]) bundle[locale] = {};
      bundle[locale][key] = row.value ?? '';
    }

    const regionShort = process.env.REGION_SHORT || 'use1';
    const client = new S3Client({
      region: process.env.S3_MEDIA_REGION || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
    });

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${regionShort}/cms/copy.json`,
        Body: JSON.stringify(bundle),
        ContentType: 'application/json',
      })
    );
    strapi.log.info(
      `[copy-export] wrote ${regionShort}/cms/copy.json (${rows.length} strings)`
    );
  } catch (err) {
    // A failed export must never break the editor's save.
    strapi.log.error('[copy-export] failed to export copy.json:', err);
  }
}
