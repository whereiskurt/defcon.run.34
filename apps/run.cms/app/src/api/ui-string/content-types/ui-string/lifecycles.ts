import { errors } from '@strapi/utils';
import { regenerateAndUpload } from '../../services/copy-export';

const UID = 'api::ui-string.ui-string';
const DEFAULT_LOCALE = 'default';

/**
 * ui-string lifecycle hooks.
 *
 * beforeCreate/beforeUpdate enforce a clean (key, locale) uniqueness guard so a
 * duplicate surfaces as a 400 ValidationError rather than a raw SQLite constraint
 * 500. A DB unique index (see database/migrations/*-ui-strings-key-locale-unique.js)
 * is the backstop if this guard is ever bypassed.
 *
 * afterCreate/afterUpdate/afterDelete regenerate the full copy.json S3 export
 * (FALL-01) so every catalog change — including deletes — is reflected in the
 * CloudFront-served fallback bundle. The export reads the full catalog and is
 * master-only + local-no-op guarded (see copy-export.ts).
 */
export default {
  async beforeCreate(event) {
    const { data } = event.params;
    const key = data?.key;
    if (!key) return;

    // Strapi reserves the `locale` attribute name: it coerces the field to Private
    // and DROPS the schema default ("default"), so a create that omits locale (the
    // default content-manager's only path — Private hides the field) would persist
    // locale=null. That silently defeats uniqueness: the guard below would compare
    // against 'default' and never match a stored null, and the DB unique index on
    // (key, locale) does not fire for NULLs (SQLite treats NULLs as distinct).
    // Write the coalesced default back into the row so locale is NEVER null on any
    // authoring path, restoring both this guard and the DB index backstop.
    const locale = data.locale ?? DEFAULT_LOCALE;
    data.locale = locale;

    const existing = await strapi.db.query(UID).findOne({
      where: { key, locale },
    });
    if (existing) {
      throw new errors.ValidationError(
        `A ui-string with key "${key}" and locale "${locale}" already exists`
      );
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    const id = where?.id;

    // Load the current row so a partial update (data omitting key or locale)
    // is checked against the row's effective post-update (key, locale).
    const current = id
      ? await strapi.db.query(UID).findOne({ where: { id } })
      : null;

    const key = data?.key ?? current?.key;
    const locale = data?.locale ?? current?.locale ?? DEFAULT_LOCALE;
    if (!key) return;

    // If this update touches locale (or the row's stored locale is a legacy null),
    // persist the resolved non-null locale so uniqueness stays enforceable.
    if (data && ('locale' in data || (current && current.locale == null))) {
      data.locale = locale;
    }

    // Reject only a collision on a DIFFERENT row; a row never collides with itself.
    const conflict = await strapi.db.query(UID).findOne({
      where: {
        key,
        locale,
        ...(id ? { id: { $ne: id } } : {}),
      },
    });
    if (conflict) {
      throw new errors.ValidationError(
        `A ui-string with key "${key}" and locale "${locale}" already exists`
      );
    }
  },

  async afterCreate() {
    await regenerateAndUpload(strapi);
  },

  async afterUpdate() {
    await regenerateAndUpload(strapi);
  },

  async afterDelete() {
    await regenerateAndUpload(strapi);
  },
};
