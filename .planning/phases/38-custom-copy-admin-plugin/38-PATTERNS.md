# Phase 38: Custom Copy Admin Plugin - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 5 (1 new page, 1 modified admin entry, 2 modified server files, 1 new/extended service)
**Analogs found:** 4 / 5 (the admin page component establishes a NEW convention — no prior custom admin page exists)

All paths are under `apps/run.cms/app/`. Absolute root:
`/Users/khundeck/working/defcon.run.34/.claude/worktrees/cms/apps/run.cms/app/`

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/admin/pages/CopyCatalog.tsx` (NEW) | admin page component | request-response / CRUD (load-all + bulk-save) | *none — first custom admin page* | **no analog** (design-system + strapi-admin hooks only) |
| `src/admin/app.tsx` (MODIFY) | admin entry / provider registration | event-driven (admin bootstrap/register) | `src/admin/app.tsx` (self — extend the default export) | role-match (adds new `register()` hook; no `addMenuLink` precedent in repo) |
| `src/api/ui-string/routes/ui-string-bulk.ts` (NEW sibling) or extend `routes/ui-string.ts` (MODIFY) | route | request-response | `src/api/health/routes/health.ts` | **exact** (plain `{ routes: [...] }` object beside a factory) |
| `src/api/ui-string/controllers/ui-string.ts` (MODIFY) | controller | CRUD (bulk-upsert) | `src/api/health/controllers/health.ts` (custom action shape) + `content-types/ui-string/lifecycles.ts` (uniqueness logic) | role-match |
| `src/api/ui-string/services/ui-string.ts` (MODIFY / extend) | service | transform + CRUD | `src/api/ui-string/services/copy-export.ts` (custom service alongside factory) | role-match |

---

## Pattern Assignments

### `src/admin/app.tsx` (MODIFY — admin entry, add page + menu link)

**Analog:** the file itself. Today it exports a default object with only `{ config, bootstrap() }` (lines 134-210). Strapi's admin entry ALSO accepts a `register(app)` hook on that same object. **No `register`/`addMenuLink` exists anywhere in this repo yet — this establishes a new convention.**

**Current export shape to extend** (`src/admin/app.tsx:134-210`):
```typescript
export default {
  config: {
    locales: ['en'],
    tutorials: false,
    notifications: { releases: false },
  },
  bootstrap() {
    if (typeof window === 'undefined') return;
    // ...fetch interception + SSO redirect...
  },
};
```

**Add a `register(app)` hook alongside `config` / `bootstrap`.** The `app` object exposes `addMenuLink` (confirmed at `node_modules/@strapi/admin/dist/admin/admin/src/StrapiApp.mjs:356` → `this.addMenuLink = (link) => this.router.addMenuLink(link)`). The `addMenuLink` argument shape is fixed by the SDK type at `node_modules/@strapi/admin/dist/admin/src/core/apis/router.d.ts:7-19` and `:53-57`:

```typescript
interface MenuItem {
  to: string;
  icon: React.ElementType;
  intlLabel: MessageDescriptor & { values?: Record<string, PrimitiveType> };
  permissions: Permission[];
  Component?: React.LazyExoticComponent<React.ComponentType>;
  exact?: boolean;
  position?: number;
}
// addMenuLink requires Component be a lazy loader:
addMenuLink: (link: Omit<MenuItem, 'Component'> & {
  Component: () => Promise<{ default: React.ComponentType }>;
}) => void;
```

**Concrete registration to write** (new `register(app)` on the default export):
```typescript
register(app) {
  app.addMenuLink({
    to: '/copy-catalog',
    icon: PlusIcon,                       // from '@strapi/icons'
    intlLabel: { id: 'copy-catalog.menu', defaultMessage: 'Copy Catalog' },
    permissions: [],                      // authenticated admins only (D-08); no custom RBAC
    Component: async () => {
      const { CopyCatalog } = await import('./pages/CopyCatalog');
      return { default: CopyCatalog };
    },
  });
},
```

**Routing note (verify empirically per CONTEXT D-01 "Note for planner"):** the menu `to` is admin-relative. The region prefix (`/{region}/admin`) is applied by the Vite `base` at `src/admin/vite.config.ts:11-12` and `config/admin.ts:20` (`url: /${regionShort}/admin`) — the same routing context `app.tsx` already reasons about (`getRegionFromPath`, `src/admin/app.tsx:29-37`). So `to: '/copy-catalog'` resolves to `/{region}/admin/copy-catalog`. Confirm the link renders and the route resolves under the region-prefixed path.

---

### `src/admin/pages/CopyCatalog.tsx` (NEW — admin page component) — NO ANALOG

**First custom admin page in this repo.** No existing file to copy structure from; the planner must compose from the SDK + design system. Concrete facts gathered so executor does not have to rediscover them:

**Verified available imports (installed versions):**
- `@strapi/design-system` **v2.0.1** — barrel export at `node_modules/@strapi/design-system/dist/index.d.ts` re-exports `./components`, `./primitives`, `./themes`, hooks. Components used by UI-SPEC (`Table`, `Textarea`, `SingleSelect`, `TextInput`, `Flex`, `Box`, `Loader`, `Typography`, `Button`, and `Th/Thead/Tbody/Tr/Td` via `Table`) are all confirmed present under `dist/components/`. Import them from the barrel: `import { Table, Textarea, ... } from '@strapi/design-system';`
- `@strapi/icons` **v2.0.1** — `import { Plus, Check, Trash } from '@strapi/icons';` (UI-SPEC icon inventory).
- Admin SDK re-exports from `@strapi/strapi/admin` (see `node_modules/@strapi/strapi/dist/admin.d.ts` → `export * from '@strapi/admin/strapi-admin'`). Use its data hooks for the fetch/save (e.g. `useFetchClient` / `getFetchClient`, `useNotification`, and the `Layouts`/`Page` shell components referenced in UI-SPEC "Page shell"). **Planner must confirm exact export names against `@strapi/admin/strapi-admin` in 5.6** — they are re-exported, not declared in the thin `admin.d.ts`.
- Runtime stack (do NOT add deps): React **18.3.1**, react-router-dom **6.30.2**, styled-components **6.1.19** (`package.json:27-32`). No Tailwind/HeroUI/shadcn on this surface (UI-SPEC Registry Safety).

**Data flow the page implements (from UI-SPEC Interaction & State Contract):**
1. Load: `GET` the full `ui-string` catalog (D-06, load-all, no pagination) via the admin fetch client → render `Loader` while pending; full-area error on failure.
2. Edit: in-memory dirty-row tracking (Claude's Discretion — per-row dirty flag; client-side key for new rows before they have a DB id).
3. Save: `POST /ui-strings/bulk-upsert` with **only dirty + new rows** (D-02) → on 2xx clear dirty flags + reconcile returned ids + success toast; on 4xx render per-row `danger` cell borders + inline errors + reject banner, preserve dirty state (D-03).
4. Namespace filter is **client-side** over the loaded list (D-04); add-row inherits active namespace prefix (D-05).

**Theming/tokens:** consume `theme.spaces[n]`, `<Typography variant>`, `theme.colors.*` — never hardcode (UI-SPEC Spacing/Typography/Color). Copywriting strings are fixed in UI-SPEC "Copywriting Contract".

---

### `src/api/ui-string/routes/*` (add custom `bulk-upsert` route)

**Analog:** `src/api/health/routes/health.ts` — **exact** structural match for a hand-written route object living beside a core factory router (health has no factory, but the plain `{ routes: [...] }` export is exactly what you add).

**Full analog** (`src/api/health/routes/health.ts:6-19`):
```typescript
export default {
  routes: [
    {
      method: 'GET',
      path: '/_health',
      handler: 'health.check',
      config: {
        auth: false,          // <-- health is public; bulk-upsert must OMIT this so admin auth applies
        policies: [],
        middlewares: [],
      },
    },
  ],
};
```

**How to apply (Strapi 5 mechanics):** `routes/ui-string.ts` currently is the core factory (`factories.createCoreRouter('api::ui-string.ui-string')`, `src/api/ui-string/routes/ui-string.ts:6`). A factory router export and a custom-routes-array export **cannot be merged in one file** cleanly. Strapi auto-loads every file under `routes/`, so **add a sibling file** (e.g. `src/api/ui-string/routes/ui-string-bulk.ts`) exporting the health-shaped object:
```typescript
export default {
  routes: [
    {
      method: 'POST',
      path: '/ui-strings/bulk-upsert',
      handler: 'ui-string.bulkUpsert',   // <-- action added to the controller below
      config: { policies: [], middlewares: [] },  // NO `auth:false` -> stays behind admin/API-token auth
    },
  ],
};
```
The core factory router (its default CRUD on `/ui-strings`) stays untouched in `routes/ui-string.ts`.

---

### `src/api/ui-string/controllers/ui-string.ts` (MODIFY — add `bulkUpsert` action)

**Analog A (action shape):** `src/api/health/controllers/health.ts` — a controller as a plain object of async `(ctx)` methods. Today ui-string's controller is the bare factory (`factories.createCoreController('api::ui-string.ui-string')`, `controllers/ui-string.ts:3`). Strapi 5 lets you pass a customizer to the factory to add methods:
```typescript
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::ui-string.ui-string', ({ strapi }) => ({
  async bulkUpsert(ctx) {
    const rows = ctx.request.body?.data ?? [];
    // delegate to service (below); return { data, errors } for the grid
    const result = await strapi.service('api::ui-string.ui-string').bulkUpsert(rows);
    if (result.errors?.length) {
      return ctx.badRequest('Save failed — nothing was written.', { errors: result.errors });
    }
    ctx.body = { data: result.saved };
  },
}));
```

**Analog B (uniqueness rule — MUST reuse, not duplicate):** `src/api/ui-string/content-types/ui-string/lifecycles.ts`. The `(key, locale)` collision rule and the null-locale coercion are already implemented there:

`beforeCreate` guard (`lifecycles.ts:34-44`):
```typescript
const locale = data.locale ?? DEFAULT_LOCALE;   // DEFAULT_LOCALE = 'default'
data.locale = locale;
const existing = await strapi.db.query(UID).findOne({ where: { key, locale } });
if (existing) {
  throw new errors.ValidationError(
    `A ui-string with key "${key}" and locale "${locale}" already exists`
  );
}
```

`beforeUpdate` "collision only on a DIFFERENT row" rule (`lifecycles.ts:67-79`):
```typescript
const conflict = await strapi.db.query(UID).findOne({
  where: { key, locale, ...(id ? { id: { $ne: id } } : {}) },
});
if (conflict) throw new errors.ValidationError(/* ...already exists... */);
```

**CONTEXT D-03 + Discretion:** the bulk-upsert should route each write through the **entity/document service so these lifecycle hooks fire naturally** — that gives the `(key,locale)` guard AND the S3 export for free (see next section), avoiding a divergent duplicate uniqueness implementation. The per-row error payload the grid renders (`ctx.badRequest(..., { errors })`) maps each `ValidationError` back to its submitted row index; UI-SPEC fixes the user-facing error copy (duplicate pair / bad namespace prefix / empty required field).

---

### `src/api/ui-string/services/ui-string.ts` (MODIFY / extend — `bulkUpsert` helper)

**Analog:** `src/api/ui-string/services/copy-export.ts` — a real, custom service module living beside the bare factory service (`services/ui-string.ts:3` is `factories.createCoreService(...)`). copy-export shows the house style for a strapi-aware helper: takes `strapi`, uses `strapi.db.query(UID)`, guards env/mode, never throws into the caller's critical path.

**Extend the factory service with a `bulkUpsert` method** (mirror the controller-B customizer form):
```typescript
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::ui-string.ui-string', ({ strapi }) => ({
  async bulkUpsert(rows) {
    // All-or-nothing (D-03): validate the whole batch, then write inside ONE
    // db transaction so a mid-batch ValidationError rolls everything back.
    // Prefer per-row entity/document-service writes so lifecycles.ts fires
    // (uniqueness guard + S3 export). See copy-export.ts for the strapi.db idiom.
  },
}));
```

**Transaction strategy is Claude's Discretion** (validate-all-then-write in one `strapi.db.transaction(...)` vs pre-flight uniqueness check). Observable requirement: atomic reject with per-row errors, reusing the Phase-35 uniqueness rule, and triggering the S3 `copy.json` export (once, or acceptably per-row).

---

## Shared Patterns

### Master-only S3 export (fires automatically if you write through lifecycles)
**Source:** `src/api/ui-string/content-types/ui-string/lifecycles.ts:82-92` + `src/api/ui-string/services/copy-export.ts:18-79`
**Apply to:** the bulk-upsert write path
```typescript
// lifecycles.ts
async afterCreate() { await regenerateAndUpload(strapi); },
async afterUpdate() { await regenerateAndUpload(strapi); },
async afterDelete() { await regenerateAndUpload(strapi); },
```
`regenerateAndUpload` is guarded `CMS_MODE === 'master'` (`copy-export.ts:21`) and S3-env-present (`copy-export.ts:35-38`); it reads the FULL catalog each call and never throws into the caller. If the bulk-upsert writes per-row via the entity/document service, the export fires once per row on master — acceptable per D-03 discretion; a batched write would need one explicit `regenerateAndUpload(strapi)` call. **Do not re-implement the export or the uniqueness check — reuse both.**

### Region-prefixed admin routing
**Source:** `src/admin/vite.config.ts:9-19`, `config/admin.ts:20`, `src/admin/app.tsx:29-37`
**Apply to:** the `addMenuLink` `to` and any in-page navigation
The Vite `base` (`/${regionShort}/admin/`) and `admin.url` prefix the whole admin SPA; page routes are declared admin-relative (`/copy-catalog`) and resolve under `/{region}/admin/`. localhost has no prefix (`getRegionFromPath` returns `null`).

### Admin authentication (no extra RBAC needed — D-08)
**Source:** `src/admin/app.tsx:149-208` (SSO-backed session; 401→SSO redirect), `config/admin.ts:24-36` (short-lived tokens, OIDC re-validation)
**Apply to:** the page (sits inside the authenticated admin panel automatically) and the `bulk-upsert` route (do NOT set `config.auth = false` — that flag is what makes `/_health` public; omitting it keeps the route behind admin/API-token auth). `addMenuLink` `permissions: []` = any authenticated admin.

### Custom-module-beside-factory convention (already established in this API)
**Source:** `src/api/ui-string/services/copy-export.ts` (custom service beside `services/ui-string.ts` factory); `src/api/health/routes/health.ts` (hand-written route object)
**Apply to:** the new bulk route file + the controller/service customizers. The repo already mixes core factories with custom modules in the same api folder — the bulk-upsert follows that grain.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/admin/pages/CopyCatalog.tsx` | admin page component | request-response / CRUD | **First custom admin page in the repo.** No prior `addMenuLink`/custom-page precedent. Establishes a new convention — the planner should treat the UI-SPEC component inventory + the verified `@strapi/design-system` v2.0.1 / `@strapi/icons` v2.0.1 / `@strapi/strapi/admin` imports (above) as the contract, and confirm exact hook export names (`useFetchClient`, `useNotification`, `Layouts`, `Page`) against `@strapi/admin/strapi-admin` in 5.6. RESEARCH.md (if present) supplies any Strapi-5-admin-page reference pattern. |

**New conventions this phase introduces (flag for planner):**
1. First `register(app)` / `addMenuLink` admin injection (previously only `config` + `bootstrap`).
2. First custom (non-factory) route + controller action on `api::ui-string` (`bulkUpsert`).
3. First `src/admin/pages/` directory.

---

## Metadata

**Analog search scope:** `apps/run.cms/app/src/admin/`, `apps/run.cms/app/src/api/` (all `routes`/`controllers`/`services`/`content-types`), `apps/run.cms/app/config/`, and installed `node_modules/@strapi/{admin,design-system,icons,strapi}` for SDK/component surface.
**Files scanned:** app.tsx, vite.config.ts, config/admin.ts, ui-string {routes, controllers, services (x2), content-types/{schema.json, lifecycles.ts}}, health {routes, controller}, package.json, plus SDK d.ts probes (StrapiApp/router MenuItem, design-system barrel).
**Pattern extraction date:** 2026-07-06
