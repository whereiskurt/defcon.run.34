/**
 * Copy Catalog — custom Strapi admin page (Phase 38-02).
 *
 * The organizer-facing authoring surface for the v1.9 ui-string copy catalog:
 * a load-all, spreadsheet-style three-column (Label · Locale · Value) grid over
 * the whole `ui-string` catalog with a client-side namespace filter, inline edit,
 * add-row, and a single bulk Save that posts only dirty + new rows to the 38-01
 * endpoint (POST /ui-strings/bulk-upsert) with atomic-reject per-row errors.
 *
 * Surface: rendered INSIDE the Strapi 5.6 admin panel (mounted via the src/admin
 * register hook in app.tsx). All spacing/typography/color derive from Strapi's
 * admin theme tokens (theme.spaces[n] via Box/Flex props, <Typography variant>,
 * theme.colors.* via token props) — no hardcoded px/hex, no external UI registry.
 *
 * First custom admin page in this repo (no prior analog); composed from
 * @strapi/design-system v2.0.1 + @strapi/icons v2.0.1 + @strapi/strapi/admin.
 */
import * as React from 'react';
import {
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Typography,
  TextInput,
  Textarea,
  SingleSelect,
  SingleSelectOption,
  Button,
  Flex,
  Box,
  Loader,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

// ── Copywriting Contract (38-UI-SPEC — verbatim) ───────────────────────────────
const COPY = {
  title: 'Copy Catalog',
  subtitle: 'Edit UI copy strings live — changes propagate to all regions within ~15 minutes.',
  namespaceLabel: 'Namespace',
  allNamespaces: 'All namespaces',
  save: 'Save',
  saving: 'Saving…',
  nothingToSave: 'Nothing to save',
  addRow: 'Add row',
  saveSuccess: 'Copy saved. Changes will reach all regions within ~15 minutes.',
  emptyHeading: 'No copy strings yet',
  emptyBody: 'Add your first row to start editing UI copy.',
  filteredEmptyHeading: 'No strings in this namespace',
  filteredEmptyBody: 'Choose "All namespaces" or add a row to this namespace.',
  rejectBanner: 'Save failed — nothing was written. Fix the highlighted rows and try again.',
  loadError: "Couldn't load the copy catalog. Refresh to try again.",
  colLabel: 'Label',
  colLocale: 'Locale',
  colValue: 'Value',
} as const;

// Namespace enum (schema.json ui-string.namespace) — drives the client-side filter (D-04).
const NAMESPACES = ['common', 'human', 'auth', 'gpx', 'bib', 'flash'] as const;
const ALL = '__all__';
const DEFAULT_LOCALE = 'default';

interface RowError {
  index: number;
  code: string;
  message: string;
}

// A grid row. `id` is the numeric DB id (null for a not-yet-saved new row);
// `tempKey` is a stable client-side key so React and dirty-tracking work before
// a new row has a DB id (D-06 discretion).
interface Row {
  id: number | null;
  tempKey: string;
  key: string;
  locale: string;
  value: string;
  dirty: boolean;
  isNew: boolean;
  errors?: RowError[];
}

let tempSeq = 0;
const nextTempKey = (): string => `new-${Date.now()}-${tempSeq++}`;

// Namespace of a row = the segment before the first dot of its dotted key (D-05).
const namespaceOf = (key: string): string => (key ?? '').split('.')[0];

const CopyCatalog: React.FC = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [rows, setRows] = React.useState<Row[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [namespace, setNamespace] = React.useState<string>(ALL);
  const [saving, setSaving] = React.useState(false);
  const [rejected, setRejected] = React.useState(false);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);

  // ── Load the FULL catalog in one fetch (D-06 — no pagination) ────────────────
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await get('/api/ui-strings?pagination[pageSize]=1000&sort=key:asc');
        if (cancelled) return;
        const list: Row[] = (data?.data ?? []).map((e: any) => ({
          id: e.id ?? null,
          tempKey: `db-${e.id}`,
          key: e.key ?? '',
          locale: e.locale ?? DEFAULT_LOCALE,
          value: e.value ?? '',
          dirty: false,
          isNew: false,
        }));
        setRows(list);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get]);

  // ── Client-side namespace filter over the already-loaded catalog (D-04) ──────
  const visibleRows = React.useMemo(() => {
    if (namespace === ALL) return rows;
    return rows.filter((r) => namespaceOf(r.key) === namespace);
  }, [rows, namespace]);

  const dirtyCount = React.useMemo(
    () => rows.filter((r) => r.dirty || r.isNew).length,
    [rows]
  );

  // ── Inline cell edits mark the row dirty (in-memory only until Save) ─────────
  const patchRow = React.useCallback((tempKey: string, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.tempKey === tempKey ? { ...r, ...patch, dirty: true, errors: undefined } : r
      )
    );
  }, []);

  // ── Add row inherits the active namespace prefix (D-05) ──────────────────────
  const addRow = React.useCallback(() => {
    const tempKey = nextTempKey();
    const keyStub = namespace === ALL ? '' : `${namespace}.`;
    setRows((prev) => [
      ...prev,
      {
        id: null,
        tempKey,
        key: keyStub,
        locale: DEFAULT_LOCALE,
        value: '',
        dirty: true,
        isNew: true,
      },
    ]);
    setFocusKey(tempKey);
  }, [namespace]);

  // ── Save: POST ONLY dirty + new rows (D-02); atomic-reject rendering (D-03) ──
  const save = React.useCallback(async () => {
    const pending = rows.filter((r) => r.dirty || r.isNew);
    if (pending.length === 0) return;

    setSaving(true);
    setRejected(false);

    // Payload preserves order so a returned per-row error `index` maps back to the
    // exact grid row. namespace is derived server-side from key, so it is omitted.
    const payload = pending.map((r) => ({
      id: r.id ?? undefined,
      key: r.key,
      locale: r.locale || DEFAULT_LOCALE,
      value: r.value,
    }));

    try {
      const { data } = await post('/api/ui-strings/bulk-upsert', { data: payload });
      const saved: any[] = data?.data ?? [];

      setRows((prev) =>
        prev.map((r) => {
          if (!(r.dirty || r.isNew)) return r;
          // Reconcile the returned DB id onto new rows by (key, locale).
          const match = saved.find(
            (s) =>
              s.key === r.key &&
              (s.locale ?? DEFAULT_LOCALE) === (r.locale || DEFAULT_LOCALE)
          );
          return {
            ...r,
            id: match?.id ?? r.id,
            dirty: false,
            isNew: false,
            errors: undefined,
          };
        })
      );

      toggleNotification({ type: 'success', message: COPY.saveSuccess });
    } catch (err: any) {
      // Atomic reject (D-03): nothing was written. Map per-row errors from the
      // Strapi error envelope back onto the submitted rows; preserve dirty state.
      const detailErrors: RowError[] = err?.response?.data?.error?.details?.errors ?? [];
      const byIndex = new Map<number, RowError[]>();
      detailErrors.forEach((e) => {
        const bucket = byIndex.get(e.index) ?? [];
        bucket.push(e);
        byIndex.set(e.index, bucket);
      });

      setRows((prev) =>
        prev.map((r) => {
          const payloadIndex = pending.findIndex((p) => p.tempKey === r.tempKey);
          if (payloadIndex < 0) return r;
          const rowErrors = byIndex.get(payloadIndex);
          return rowErrors ? { ...r, errors: rowErrors } : { ...r, errors: undefined };
        })
      );
      setRejected(true);
    } finally {
      setSaving(false);
    }
  }, [rows, post, toggleNotification]);

  // Move focus to a newly added row's Label cell.
  const registerFocus = React.useCallback(
    (tempKey: string) => (el: HTMLInputElement | null) => {
      if (el && tempKey === focusKey) {
        el.focus();
        setFocusKey(null);
      }
    },
    [focusKey]
  );

  return (
    <Page.Main>
      <Layouts.Root>
        <Layouts.Header title={COPY.title} subtitle={COPY.subtitle} />
        <Layouts.Content>
          {status === 'loading' && (
            <Flex justifyContent="center" padding={8}>
              <Loader>Loading…</Loader>
            </Flex>
          )}

          {status === 'error' && (
            <Box padding={8} background="neutral0" hasRadius>
              <Typography variant="omega" textColor="danger600">
                {COPY.loadError}
              </Typography>
            </Box>
          )}

          {status === 'ready' && (
            <Flex direction="column" alignItems="stretch" gap={4}>
              {/* Toolbar */}
              <Flex justifyContent="space-between" gap={2}>
                <Box width="20rem">
                  <SingleSelect
                    aria-label={COPY.namespaceLabel}
                    placeholder={COPY.namespaceLabel}
                    value={namespace}
                    onChange={(v) => setNamespace(String(v))}
                  >
                    <SingleSelectOption value={ALL}>{COPY.allNamespaces}</SingleSelectOption>
                    {NAMESPACES.map((ns) => (
                      <SingleSelectOption key={ns} value={ns}>
                        {ns}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Box>
                <Flex gap={2}>
                  <Button variant="secondary" startIcon={<Plus />} onClick={addRow}>
                    {COPY.addRow}
                  </Button>
                  <Button onClick={save} disabled={saving || dirtyCount === 0} loading={saving}>
                    {saving ? COPY.saving : COPY.save}
                  </Button>
                </Flex>
              </Flex>

              {rejected && (
                <Box padding={3} background="danger100" hasRadius>
                  <Typography variant="omega" textColor="danger700">
                    {COPY.rejectBanner}
                  </Typography>
                </Box>
              )}

              {dirtyCount === 0 && (
                <Typography variant="pi" textColor="neutral600">
                  {COPY.nothingToSave}
                </Typography>
              )}

              {/* Empty / filtered-empty states */}
              {rows.length === 0 ? (
                <Flex direction="column" alignItems="center" gap={2} padding={8}>
                  <Typography variant="beta">{COPY.emptyHeading}</Typography>
                  <Typography variant="omega" textColor="neutral600">
                    {COPY.emptyBody}
                  </Typography>
                </Flex>
              ) : visibleRows.length === 0 ? (
                <Flex direction="column" alignItems="center" gap={2} padding={8}>
                  <Typography variant="beta">{COPY.filteredEmptyHeading}</Typography>
                  <Typography variant="omega" textColor="neutral600">
                    {COPY.filteredEmptyBody}
                  </Typography>
                </Flex>
              ) : (
                <Table colCount={3} rowCount={visibleRows.length}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma">{COPY.colLabel}</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">{COPY.colLocale}</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">{COPY.colValue}</Typography>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {visibleRows.map((row) => {
                      const changed = row.dirty || row.isNew;
                      const hasError = !!row.errors?.length;
                      return (
                        <Tr key={row.tempKey} background={changed ? 'primary100' : undefined}>
                          <Td>
                            <Flex direction="column" alignItems="stretch" gap={1}>
                              <TextInput
                                aria-label={COPY.colLabel}
                                value={row.key}
                                hasError={hasError}
                                ref={registerFocus(row.tempKey)}
                                onChange={(e: any) => patchRow(row.tempKey, { key: e.target.value })}
                              />
                              {row.errors?.map((err) => (
                                <Typography key={err.code} variant="pi" textColor="danger600">
                                  {err.message}
                                </Typography>
                              ))}
                            </Flex>
                          </Td>
                          <Td>
                            <TextInput
                              aria-label={COPY.colLocale}
                              value={row.locale}
                              hasError={hasError}
                              onChange={(e: any) => patchRow(row.tempKey, { locale: e.target.value })}
                            />
                          </Td>
                          <Td>
                            <Textarea
                              aria-label={COPY.colValue}
                              value={row.value}
                              hasError={hasError}
                              rows={2}
                              onChange={(e: any) => patchRow(row.tempKey, { value: e.target.value })}
                            />
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              )}
            </Flex>
          )}
        </Layouts.Content>
      </Layouts.Root>
    </Page.Main>
  );
};

export { CopyCatalog };
export default CopyCatalog;
