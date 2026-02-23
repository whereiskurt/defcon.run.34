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
  },
};
