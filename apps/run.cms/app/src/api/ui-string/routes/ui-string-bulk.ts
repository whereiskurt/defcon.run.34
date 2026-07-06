/**
 * Custom bulk-upsert route for ui-string (Phase 38-01, ADMN-03/D-02).
 *
 * A hand-written route object living beside the core factory router
 * (routes/ui-string.ts) — Strapi 5 auto-loads every file under routes/, and a
 * factory-router export and a custom-routes array cannot be merged cleanly in one
 * file, so this sits in a sibling. The default /ui-strings CRUD is untouched.
 *
 * CRITICAL: no `config.auth = false`. Omitting it keeps this endpoint behind
 * Strapi's admin/API-token auth (admin-only authoring surface). The Phase-35
 * read-only toolkit token has no write grant and is denied here (T-38-01).
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/ui-strings/bulk-upsert',
      handler: 'ui-string.bulkUpsert',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
