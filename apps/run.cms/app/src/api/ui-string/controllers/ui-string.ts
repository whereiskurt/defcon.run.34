import { factories } from '@strapi/strapi';

const UID = 'api::ui-string.ui-string';

// 38-UI-SPEC Copywriting Contract — "Error banner (atomic reject)" (verbatim).
const REJECT_BANNER = 'Save failed — nothing was written. Fix the highlighted rows and try again.';

/**
 * ui-string controller — extends the core factory with the `bulkUpsert` action
 * (Phase 38-01). Reads `ctx.request.body.data` (the dirty + new rows, D-02),
 * delegates to the service, and maps the all-or-nothing result to HTTP:
 *   - any error  -> 400 with per-row `{ errors }` the grid renders inline (D-03)
 *   - clean save -> 200 `{ data: saved }` for new-row id reconciliation
 */
export default factories.createCoreController(UID, ({ strapi }) => ({
  async bulkUpsert(ctx) {
    const rows = ctx.request.body?.data;
    if (!Array.isArray(rows)) {
      return ctx.badRequest('Expected an array of rows in `data`.');
    }

    const result = await strapi.service(UID).bulkUpsert(rows);

    if (result.errors?.length) {
      return ctx.badRequest(REJECT_BANNER, { errors: result.errors });
    }

    ctx.body = { data: result.saved };
  },
}));
