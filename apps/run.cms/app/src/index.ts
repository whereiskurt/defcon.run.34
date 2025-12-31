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
  },
};
