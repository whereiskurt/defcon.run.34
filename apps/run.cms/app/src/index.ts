import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import publicRoutes from './seed/public-routes.json';

/**
 * Seed the curated public-overlay routes (create-if-absent, published).
 *
 * Reads src/seed/public-routes.json — the git source of truth also used by
 * scripts/push-routes.mjs — and creates a published Route for any gpxFileId
 * that doesn't already have one. This is a BASELINE: once a Route exists it's
 * left alone, so names edited in the CMS admin UI (or via push-routes.mjs) are
 * never overwritten. Master-only; workers receive it via Litestream.
 */
async function seedPublicRoutes(strapi) {
  let created = 0;
  for (const r of publicRoutes as Array<{ gpxFileId: string; name: string }>) {
    if (!r.gpxFileId || !r.name) continue;

    const existing = await strapi.documents('api::route.route').findFirst({
      filters: { gpxFileId: r.gpxFileId },
    });
    if (existing) continue;

    // slug (uid) and routeType (enum) are required to publish. Derive a slug
    // from the name; default routeType to point-to-point (editable in the CMS).
    const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const doc = await strapi.documents('api::route.route').create({
      data: { name: r.name, gpxFileId: r.gpxFileId, slug, routeType: 'point-to-point' },
    });
    await strapi.documents('api::route.route').publish({ documentId: doc.documentId });
    created++;
  }
  if (created > 0) {
    strapi.log.info(`[Bootstrap] Seeded ${created} public overlay route(s)`);
  }
}

async function ensureApiTokenPublished(strapi) {
  const ssmPrefix = process.env.SSM_PREFIX;
  if (!ssmPrefix) {
    strapi.log.warn('[Bootstrap] SSM_PREFIX not set — skipping API token publish');
    return;
  }

  const tokenName = 'run-human-internal';
  const tokenDescription = 'Internal read-only access for run.human';
  const tokenSvc = strapi.service('admin::api-token');

  // Mint the shared token exactly once, then never touch it again.
  //
  // Strapi CE stores only a salted sha512 *hash* of an API token — the plaintext
  // is NOT recoverable from the database (there is no encryptedKey copy). The
  // previous bootstrap worked around that by deleting and re-creating the token
  // on every boot to obtain a fresh plaintext for SSM. That rotated the stored
  // hash on every master restart, which nothing downstream can keep up with:
  //   - CMS worker replicas restore the DB via Litestream only every ~5 min, so
  //     a freshly-minted token 401s against every worker until the next sync.
  //   - Consumers (run.gpx, run.human) read the plaintext once at their own
  //     container start; a master boot after they start invalidates their token
  //     against BOTH tiers until they redeploy.
  //
  // The master's DB persists across boots (Litestream restore-on-start), so once
  // the token row exists we leave it — and its already-published SSM value —
  // untouched. Every worker replica and consumer then converges and stays
  // converged. (Plaintext is only knowable at creation; if SSM is ever cleared
  // out-of-band, delete the token row to force a fresh mint + republish.)
  const existing = await strapi.query('admin::api-token').findOne({
    where: { name: tokenName },
  });
  if (existing) {
    strapi.log.info(`[Bootstrap] API token "${tokenName}" already exists — leaving it (and its SSM value) untouched`);
    return;
  }

  const created = await tokenSvc.create({
    name: tokenName,
    description: tokenDescription,
    type: 'read-only',
  });
  const plaintext: string = created.accessKey;
  strapi.log.info(`[Bootstrap] Minted API token "${tokenName}"`);

  // Publish to SSM in all worker regions so workers can read the token
  // SSM_REPLICATE_TO is a comma-separated list of "region:label" pairs (e.g. "ca-central-1:cac1,ap-southeast-1:apse1")
  const localRegion = process.env.AWS_REGION || 'us-east-1';
  const localSsmPath = `/${ssmPrefix}/strapi/run_human_api_token`;
  const localSsm = new SSMClient({ region: localRegion });

  await localSsm.send(new PutParameterCommand({
    Name: localSsmPath,
    Value: plaintext,
    Type: 'SecureString',
    Overwrite: true,
  }));
  strapi.log.info(`[Bootstrap] Published API token to SSM: ${localSsmPath} (${localRegion})`);

  // Replicate to other regions if configured
  const siteLabel = ssmPrefix.split('/')[0]; // "dc34" from "dc34/secrets/use1"
  const replicateTo = process.env.SSM_REPLICATE_TO || '';
  if (replicateTo) {
    for (const entry of replicateTo.split(',').map(s => s.trim()).filter(Boolean)) {
      const [region, label] = entry.split(':');
      const ssmPath = `/${siteLabel}/secrets/${label}/strapi/run_human_api_token`;
      const ssm = new SSMClient({ region });

      await ssm.send(new PutParameterCommand({
        Name: ssmPath,
        Value: plaintext,
        Type: 'SecureString',
        Overwrite: true,
      }));
      strapi.log.info(`[Bootstrap] Replicated API token to SSM: ${ssmPath} (${region})`);
    }
  }
}

async function revokePublicPermissions(strapi) {
  // Find the Public role
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) {
    return;
  }

  // Disable ALL public permissions on content-api actions
  const publicActions = [
    'api::event.event.find',
    'api::event.event.findOne',
    'api::route.route.find',
    'api::route.route.findOne',
    'api::point-of-interest.point-of-interest.find',
    'api::point-of-interest.point-of-interest.findOne',
    'api::ui-string.ui-string.find',
    'api::ui-string.ui-string.findOne',
  ];

  let revoked = 0;
  for (const action of publicActions) {
    const existing = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: publicRole.id } });

    if (existing && existing.enabled) {
      await strapi.query('plugin::users-permissions.permission').update({
        where: { id: existing.id },
        data: { enabled: false },
      });
      revoked++;
    }
  }

  if (revoked > 0) {
    strapi.log.info(`[Bootstrap] Revoked ${revoked} public API permissions — all content requires API token auth`);
  }
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    // Log CMS mode on startup
    const mode = process.env.CMS_MODE || 'unknown';
    strapi.log.info(`CMS starting in ${mode.toUpperCase()} mode`);

    // Log database path
    const dbPath = process.env.DATABASE_FILENAME || '.tmp/data.db';
    strapi.log.info(`Database path: ${dbPath}`);

    // For worker mode, set read-only behavior
    if (mode === 'worker') {
      strapi.log.info('Worker mode: Write operations are disabled');
    }

    // Auto-seed admin user if none exists
    try {
      const adminExists = await strapi.service('admin::user').exists();
      if (!adminExists) {
        const email = process.env.STRAPI_ADMIN_EMAIL;
        const password = process.env.STRAPI_ADMIN_PASSWORD;
        if (email && password) {
          const superAdminRole = await strapi.service('admin::role').getSuperAdmin();
          await strapi.service('admin::user').create({
            email,
            password,
            firstname: 'Admin',
            lastname: 'User',
            isActive: true,
            registrationToken: null,
            roles: [superAdminRole.id],
          });
          strapi.log.info(`Seeded admin user: ${email}`);
        } else {
          strapi.log.warn('No admin user exists and STRAPI_ADMIN_EMAIL not set — register-admin endpoint may be exposed');
        }
      }
    } catch (err) {
      strapi.log.error('Failed to seed admin user:', err);
    }

    // Revoke public API permissions — all content requires API token auth
    try {
      await revokePublicPermissions(strapi);
    } catch (err) {
      strapi.log.error('[Bootstrap] Failed to revoke public permissions:', err);
    }

    // Master only: Create API token and publish to SSM for run.human
    if (mode === 'master') {
      try {
        await ensureApiTokenPublished(strapi);
      } catch (err) {
        strapi.log.error('[Bootstrap] Failed to publish API token to SSM:', err);
      }

      // Master only: seed curated public-overlay Route names (create-if-absent)
      try {
        await seedPublicRoutes(strapi);
      } catch (err) {
        strapi.log.error('[Bootstrap] Failed to seed public overlay routes:', err);
      }
    }
  },
};
