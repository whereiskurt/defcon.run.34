import { factories } from '@strapi/strapi';
import { validateBatch, deriveNamespace, resolveLocale, MESSAGES, type BulkRow, type RowError } from './bulk-validate';

const UID = 'api::ui-string.ui-string';

/**
 * ui-string service — extends the core factory with `bulkUpsert` (Phase 38-01, ADMN-03/D-02/D-03).
 *
 * Atomic all-or-nothing: the whole batch is validated (pure intra-batch checks +
 * a cross-row DB uniqueness pass) BEFORE anything is written. Any error => nothing
 * is persisted and per-row `{ index, code, message }` detail is returned. On a clean
 * batch every row is written through `strapi.db.query(UID)` inside ONE transaction so
 * the Phase-35 lifecycle hooks fire naturally — reusing the (key,locale) uniqueness
 * guard AND the copy.json S3 export (afterCreate/afterUpdate). The uniqueness rule and
 * export are NOT re-implemented here; only orchestrated.
 */
export default factories.createCoreService(UID, ({ strapi }) => ({
  async bulkUpsert(rows: BulkRow[]): Promise<{ saved: Array<{ index: number; id: number; key: string; locale: string }>; errors?: RowError[] }> {
    if (!Array.isArray(rows)) {
      return { saved: [], errors: [{ index: -1, code: 'EMPTY_REQUIRED_FIELD', message: MESSAGES.EMPTY_REQUIRED_FIELD }] };
    }

    // 1. Pure pre-flight (intra-batch duplicates, namespace prefix, empty required).
    const errors: RowError[] = validateBatch(rows);
    const flagged = new Set(errors.map((e) => e.index));

    // 2. Cross-row uniqueness against existing DB rows (same shape as the
    //    lifecycles.ts beforeUpdate guard: a collision only on a DIFFERENT id).
    //    Skip rows already flagged — they will not be written anyway.
    for (let index = 0; index < rows.length; index++) {
      if (flagged.has(index)) continue;
      const row = rows[index];
      const key = String(row.key).trim();
      const locale = resolveLocale(row.locale);
      const id = row.id ?? undefined;
      const conflict = await strapi.db.query(UID).findOne({
        where: { key, locale, ...(id ? { id: { $ne: id } } : {}) },
      });
      if (conflict) {
        errors.push({ index, code: 'DUPLICATE_PAIR', message: MESSAGES.DUPLICATE_PAIR });
      }
    }

    // 3. Any error => write nothing (so the S3 export never fires on a rejected save).
    if (errors.length) {
      return { saved: [], errors };
    }

    // 4. Clean batch: write every row inside ONE transaction. A mid-batch throw
    //    (the lifecycle uniqueness guard as backstop) rolls the whole batch back.
    let saved: Array<{ index: number; id: number; key: string; locale: string }> = [];
    try {
      await strapi.db.transaction(async () => {
        const results: Array<{ index: number; id: number; key: string; locale: string }> = [];
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          const key = String(row.key).trim();
          const locale = resolveLocale(row.locale);
          // The grid posts only key/locale/value, but schema.json marks `namespace`
          // required — persist the derived prefix so a create doesn't throw
          // "namespace must be defined".
          const namespace = deriveNamespace(key);
          const value = row.value ?? '';
          const data = { key, locale, value, namespace };

          try {
            const persisted = row.id
              ? await strapi.db.query(UID).update({ where: { id: row.id }, data })
              : await strapi.db.query(UID).create({ data });
            results.push({ index, id: persisted.id, key, locale });
          } catch (err: any) {
            // Attribute the failing row so the caller can surface it, then abort
            // the transaction (rolls back everything already written this batch).
            const rowErr = new Error(err?.message ?? 'Save failed');
            (rowErr as any).rowIndex = index;
            throw rowErr;
          }
        }
        saved = results;
      });
    } catch (err: any) {
      const index = typeof err?.rowIndex === 'number' ? err.rowIndex : -1;
      return {
        saved: [],
        errors: [{ index, code: 'DUPLICATE_PAIR', message: err?.message ?? MESSAGES.DUPLICATE_PAIR }],
      };
    }

    // 5. Full success — return saved rows so the grid can reconcile new-row client
    //    keys with their DB ids.
    return { saved };
  },
}));
