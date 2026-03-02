import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

async function ensureApiTokenPublished(strapi) {
  const ssmPrefix = process.env.SSM_PREFIX;
  if (!ssmPrefix) {
    strapi.log.warn('[Bootstrap] SSM_PREFIX not set — skipping API token publish');
    return;
  }

  const tokenName = 'run-human-internal';
  let plaintext: string;

  // Check if token already exists
  const existing = await strapi.query('admin::api-token').findOne({
    where: { name: tokenName },
  });

  if (existing) {
    // Strapi hashes tokens — can't recover plaintext from existing. Delete and re-create.
    strapi.log.info(`[Bootstrap] API token "${tokenName}" exists — re-creating to obtain plaintext`);
    await strapi.query('admin::api-token').delete({ where: { id: existing.id } });
    const created = await strapi.service('admin::api-token').create({
      name: tokenName,
      description: 'Internal read-only access for run.human',
      type: 'read-only',
    });
    plaintext = created.accessKey;
    strapi.log.info(`[Bootstrap] Re-created API token "${tokenName}" and obtained plaintext`);
  } else {
    // Create new read-only API token
    const created = await strapi.service('admin::api-token').create({
      name: tokenName,
      description: 'Internal read-only access for run.human',
      type: 'read-only',
    });
    plaintext = created.accessKey;
    strapi.log.info(`[Bootstrap] Created API token "${tokenName}"`);
  }

  // Publish to SSM
  const ssmPath = `/${ssmPrefix}/strapi/run_human_api_token`;
  const region = process.env.AWS_REGION || 'us-east-1';
  const ssm = new SSMClient({ region });

  await ssm.send(new PutParameterCommand({
    Name: ssmPath,
    Value: plaintext,
    Type: 'SecureString',
    Overwrite: true,
  }));

  strapi.log.info(`[Bootstrap] Published API token to SSM: ${ssmPath}`);
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
    }
  },
};
