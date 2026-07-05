'use strict';

/**
 * Add a UNIQUE index on ui_strings(key, locale) as a DB-level backstop for the
 * lifecycle uniqueness guard (see src/api/ui-string/content-types/ui-string/lifecycles.ts).
 *
 * Idempotent (CREATE UNIQUE INDEX IF NOT EXISTS) and Litestream-safe: workers
 * restore master's DB wholesale, so this only needs to run on master. The
 * hasTable guard makes a worker booting against a not-yet-replicated DB a no-op
 * rather than an error. `key` is quoted because it is a SQLite reserved word.
 */
module.exports = {
  async up(knex) {
    const hasTable = await knex.schema.hasTable('ui_strings');
    if (!hasTable) return;

    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS ui_strings_key_locale_unique ON ui_strings ("key", "locale")'
    );
  },

  async down(knex) {
    await knex.raw('DROP INDEX IF EXISTS ui_strings_key_locale_unique');
  },
};
