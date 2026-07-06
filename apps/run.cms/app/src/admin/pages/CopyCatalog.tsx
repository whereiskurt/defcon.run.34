/**
 * Copy Catalog — custom Strapi admin page (Phase 38).
 *
 * The organizer-facing authoring surface for the v1.9 ui-string copy catalog:
 * a load-all, DENSE spreadsheet-style three-column (Label · Locale · Value) grid
 * over the whole `ui-string` catalog with a namespace filter + free-text search,
 * inline edit, add-row, and a single bulk Save that posts only dirty + new rows to
 * the admin-authed endpoint (POST /copy-catalog/ui-strings/bulk-upsert) with
 * atomic-reject per-row errors.
 *
 * Surface: rendered INSIDE the Strapi 5.6 admin panel (mounted via the src/admin
 * register hook in app.tsx), so it inherits admin auth (SSO) + nav chrome. The grid
 * itself is a compact native <table> styled via styled-components against Strapi's
 * theme tokens (theme.colors.* — light/dark aware) rather than the roomy
 * @strapi/design-system field components, so it reads like a real spreadsheet.
 */
import * as React from 'react';
import {
  Typography,
  TextInput,
  SingleSelect,
  SingleSelectOption,
  Button,
  Flex,
  Box,
  Loader,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import styled from 'styled-components';

// ── Copywriting Contract (38-UI-SPEC — verbatim, + dense-mode additions) ───────
const COPY = {
  title: 'Copy Catalog',
  subtitle: 'Edit UI copy strings live — changes propagate to all regions within ~15 minutes.',
  namespaceLabel: 'Namespace',
  allNamespaces: 'All namespaces',
  searchPlaceholder: 'Search key or value…',
  save: 'Save',
  saving: 'Saving…',
  nothingToSave: 'Nothing to save',
  addRow: 'Add row',
  saveSuccess: 'Copy saved. Changes will reach all regions within ~15 minutes.',
  emptyHeading: 'No copy strings yet',
  emptyBody: 'Add your first row to start editing UI copy.',
  filteredEmptyHeading: 'No matching strings',
  filteredEmptyBody: 'Clear the search or namespace filter, or add a row.',
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
// a new row has a DB id.
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

// ── Dense spreadsheet styling (theme-token driven, light/dark aware) ───────────
const Grid = styled.table`
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
`;

const HeadCell = styled.th<{ $w?: string }>`
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 3px 8px;
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral600};
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
  width: ${({ $w }) => $w || 'auto'};
`;

const BodyRow = styled.tr<{ $dirty?: boolean; $error?: boolean }>`
  background: ${({ theme, $dirty, $error }) =>
    $error ? theme.colors.danger100 : $dirty ? theme.colors.primary100 : theme.colors.neutral0};
  &:nth-of-type(even) {
    background: ${({ theme, $dirty, $error }) =>
      $error ? theme.colors.danger100 : $dirty ? theme.colors.primary100 : theme.colors.neutral100};
  }
  &:hover {
    background: ${({ theme, $dirty, $error }) =>
      $error ? theme.colors.danger100 : $dirty ? theme.colors.primary100 : theme.colors.neutral150};
  }
`;

const Cell = styled.td`
  padding: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
  vertical-align: middle;
  &:last-of-type {
    border-right: none;
  }
`;

const CellInput = styled.input<{ $mono?: boolean; $error?: boolean }>`
  width: 100%;
  box-sizing: border-box;
  border: none;
  background: transparent;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 16px;
  color: ${({ theme, $error }) => ($error ? theme.colors.danger600 : theme.colors.neutral800)};
  font-family: ${({ $mono }) =>
    $mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit'};
  &:focus {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
    background: ${({ theme }) => theme.colors.neutral0};
  }
  &::placeholder {
    color: ${({ theme }) => theme.colors.neutral500};
  }
`;

const ErrorRowCell = styled.td`
  padding: 2px 10px 4px;
  background: ${({ theme }) => theme.colors.danger100};
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

// ── Namespace colour map — one hue per section, readable on light + dark ───────
const NS_COLORS: Record<string, string> = {
  common: '#64748B', // slate
  bib: '#2563EB', // blue
  human: '#059669', // green
  auth: '#D97706', // amber
  gpx: '#7C3AED', // violet
  flash: '#DB2777', // pink
};
const nsColor = (key: string): string => NS_COLORS[namespaceOf(key)] ?? '#64748B';

// Label cell shows the key as colour-coded, dot-separated segments (display mode);
// clicking swaps to the raw monospace input (edit mode). Native inputs can't colour
// sub-strings, so the read/edit split is what makes `x.y.z` sections visually distinct.
const KeyDisplay = styled.div`
  width: 100%;
  box-sizing: border-box;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
  &:focus {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
`;
const Dot = styled.span`
  color: ${({ theme }) => theme.colors.neutral400};
  padding: 0 1px;
`;
const Seg = styled.span<{ $color?: string; $bold?: boolean; $muted?: boolean }>`
  color: ${({ theme, $color, $muted }) =>
    $color || ($muted ? theme.colors.neutral600 : theme.colors.neutral800)};
  font-weight: ${({ $bold }) => ($bold ? 600 : 400)};
`;

const renderKeySegments = (key: string): React.ReactNode => {
  const parts = key.split('.');
  const last = parts.length - 1;
  const color = nsColor(key);
  return parts.map((seg, i) => (
    <React.Fragment key={i}>
      {i > 0 && <Dot>.</Dot>}
      {/* first segment = namespace (tinted + bold); middle segments muted; last = emphasized */}
      <Seg $color={i === 0 ? color : undefined} $bold={i === 0} $muted={i !== 0 && i !== last}>
        {seg}
      </Seg>
    </React.Fragment>
  ));
};

interface KeyCellProps {
  value: string;
  error: boolean;
  startEditing: boolean;
  onStartEditing: () => void;
  onChange: (v: string) => void;
}

const KeyCell: React.FC<KeyCellProps> = ({ value, error, startEditing, onStartEditing, onChange }) => {
  const [editing, setEditing] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // A freshly added row opens straight into edit mode with focus (D-05).
  React.useEffect(() => {
    if (startEditing) {
      setEditing(true);
      onStartEditing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEditing]);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <CellInput
        ref={inputRef}
        $mono
        $error={error}
        aria-label={COPY.colLabel}
        value={value}
        placeholder="namespace.area.element"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
      />
    );
  }
  return (
    <KeyDisplay
      role="button"
      tabIndex={0}
      aria-label={COPY.colLabel}
      title={value}
      onClick={() => setEditing(true)}
      onFocus={() => setEditing(true)}
    >
      {value ? (
        renderKeySegments(value)
      ) : (
        <Seg $muted>namespace.area.element</Seg>
      )}
    </KeyDisplay>
  );
};

const CopyCatalog: React.FC = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [rows, setRows] = React.useState<Row[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [namespace, setNamespace] = React.useState<string>(ALL);
  const [search, setSearch] = React.useState<string>('');
  const [saving, setSaving] = React.useState(false);
  const [rejected, setRejected] = React.useState(false);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);

  // ── Load the FULL catalog in one fetch (D-06 — no pagination) ────────────────
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await get('/copy-catalog/ui-strings?pagination[pageSize]=1000&sort=key:asc');
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

  // ── Client-side namespace + text filter over the already-loaded catalog (D-04) ─
  const visibleRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (namespace === ALL || namespaceOf(r.key) === namespace) &&
        (q === '' ||
          r.key.toLowerCase().includes(q) ||
          r.value.toLowerCase().includes(q))
    );
  }, [rows, namespace, search]);

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
      const { data } = await post('/copy-catalog/ui-strings/bulk-upsert', { data: payload });
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
            <Box padding={6} background="neutral0" hasRadius>
              <Typography variant="omega" textColor="danger600">
                {COPY.loadError}
              </Typography>
            </Box>
          )}

          {status === 'ready' && (
            <Flex direction="column" alignItems="stretch" gap={3}>
              {/* Dense toolbar: namespace filter · key/value search · row count · Add · Save */}
              <Flex justifyContent="space-between" gap={2} wrap="wrap">
                <Flex gap={2}>
                  <Box width="12rem">
                    <SingleSelect
                      size="S"
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
                  <Box width="18rem">
                    <TextInput
                      size="S"
                      aria-label="Search"
                      placeholder={COPY.searchPlaceholder}
                      value={search}
                      onChange={(e: any) => setSearch(e.target.value)}
                    />
                  </Box>
                  <Flex paddingLeft={1}>
                    <Typography variant="pi" textColor="neutral600">
                      {visibleRows.length}
                      {visibleRows.length === rows.length ? '' : ` / ${rows.length}`} rows
                      {dirtyCount > 0 ? ` · ${dirtyCount} unsaved` : ''}
                    </Typography>
                  </Flex>
                </Flex>
                <Flex gap={2}>
                  <Button size="S" variant="secondary" startIcon={<Plus />} onClick={addRow}>
                    {COPY.addRow}
                  </Button>
                  <Button
                    size="S"
                    onClick={save}
                    disabled={saving || dirtyCount === 0}
                    loading={saving}
                  >
                    {saving ? COPY.saving : dirtyCount === 0 ? COPY.nothingToSave : COPY.save}
                  </Button>
                </Flex>
              </Flex>

              {rejected && (
                <Box padding={2} background="danger100" hasRadius>
                  <Typography variant="pi" textColor="danger700">
                    {COPY.rejectBanner}
                  </Typography>
                </Box>
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
                <Box hasRadius overflow="hidden">
                  <Grid>
                    <thead>
                      <tr>
                        <HeadCell $w="34%">{COPY.colLabel}</HeadCell>
                        <HeadCell $w="12%">{COPY.colLocale}</HeadCell>
                        <HeadCell>{COPY.colValue}</HeadCell>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => {
                        const changed = row.dirty || row.isNew;
                        const hasError = !!row.errors?.length;
                        return (
                          <React.Fragment key={row.tempKey}>
                            <BodyRow $dirty={changed} $error={hasError}>
                              <Cell>
                                <KeyCell
                                  value={row.key}
                                  error={hasError}
                                  startEditing={row.tempKey === focusKey}
                                  onStartEditing={() => setFocusKey(null)}
                                  onChange={(v) => patchRow(row.tempKey, { key: v })}
                                />
                              </Cell>
                              <Cell>
                                <CellInput
                                  $mono
                                  aria-label={COPY.colLocale}
                                  value={row.locale}
                                  onChange={(e) => patchRow(row.tempKey, { locale: e.target.value })}
                                />
                              </Cell>
                              <Cell>
                                <CellInput
                                  aria-label={COPY.colValue}
                                  value={row.value}
                                  placeholder="(empty)"
                                  onChange={(e) => patchRow(row.tempKey, { value: e.target.value })}
                                />
                              </Cell>
                            </BodyRow>
                            {hasError && (
                              <tr>
                                <ErrorRowCell colSpan={3}>
                                  {row.errors?.map((err) => (
                                    <Typography key={err.code} variant="pi" textColor="danger700">
                                      {err.message}
                                    </Typography>
                                  ))}
                                </ErrorRowCell>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </Grid>
                </Box>
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
