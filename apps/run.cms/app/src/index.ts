async function ensurePublicPermissions(strapi) {
  const pluginStore = strapi.store({
    type: 'plugin',
    name: 'users-permissions',
  });

  const publicPermissionsConfigured = await pluginStore.get({
    key: 'publicPermissionsConfigured',
  });

  if (publicPermissionsConfigured) {
    return; // Already configured — idempotent guard
  }

  // Find the Public role
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) {
    strapi.log.warn('[Bootstrap] Public role not found — skipping permission setup');
    return;
  }

  // Grant read-only access (find + findOne) for all three content types
  const publicActions = [
    'api::event.event.find',
    'api::event.event.findOne',
    'api::route.route.find',
    'api::route.route.findOne',
    'api::point-of-interest.point-of-interest.find',
    'api::point-of-interest.point-of-interest.findOne',
  ];

  for (const action of publicActions) {
    const existing = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: publicRole.id } });

    if (existing) {
      // Permission record exists — ensure it's enabled
      if (!existing.enabled) {
        await strapi.query('plugin::users-permissions.permission').update({
          where: { id: existing.id },
          data: { enabled: true },
        });
      }
    } else {
      // Permission record doesn't exist — create it
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action, role: publicRole.id, enabled: true },
      });
    }
  }

  // Mark as configured so this doesn't re-run on every restart
  await pluginStore.set({
    key: 'publicPermissionsConfigured',
    value: true,
  });

  strapi.log.info('[Bootstrap] Public API permissions configured (find + findOne for events, routes, points-of-interest)');
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

    // Configure public read-only API permissions (idempotent)
    try {
      await ensurePublicPermissions(strapi);
    } catch (err) {
      strapi.log.error('[Bootstrap] Failed to configure public permissions:', err);
    }
  },
};
