/**
 * Copy Catalog — custom Strapi admin page (Phase 38-02).
 *
 * The organizer-facing authoring surface for the v1.9 ui-string copy catalog:
 * a load-all, spreadsheet-style three-column (Label · Locale · Value) grid over
 * the whole `ui-string` catalog. Task 1 delivers registration + read/render;
 * the client-side namespace filter, dirty tracking, add-row, and bulk Save are
 * added in Task 2.
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
  Flex,
  Box,
  Loader,
} from '@strapi/design-system';
import { Layouts, Page, useFetchClient } from '@strapi/strapi/admin';

// ── Copywriting Contract (38-UI-SPEC — verbatim) ───────────────────────────────
const COPY = {
  title: 'Copy Catalog',
  subtitle: 'Edit UI copy strings live — changes propagate to all regions within ~15 minutes.',
  emptyHeading: 'No copy strings yet',
  emptyBody: 'Add your first row to start editing UI copy.',
  loadError: "Couldn't load the copy catalog. Refresh to try again.",
  colLabel: 'Label',
  colLocale: 'Locale',
  colValue: 'Value',
} as const;

const DEFAULT_LOCALE = 'default';

// A grid row. `id` is the numeric DB id (null for a not-yet-saved new row);
// `tempKey` is a stable client-side key so React keys work before a new row has
// a DB id (D-06 discretion).
interface Row {
  id: number | null;
  tempKey: string;
  key: string;
  locale: string;
  value: string;
}

const CopyCatalog: React.FC = () => {
  const { get } = useFetchClient();

  const [rows, setRows] = React.useState<Row[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');

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

  // Inline cell edits update local state (dirty tracking + Save arrive in Task 2).
  const patchRow = React.useCallback((tempKey: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.tempKey === tempKey ? { ...r, ...patch } : r)));
  }, []);

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

          {status === 'ready' &&
            (rows.length === 0 ? (
              <Flex direction="column" alignItems="center" gap={2} padding={8}>
                <Typography variant="beta">{COPY.emptyHeading}</Typography>
                <Typography variant="omega" textColor="neutral600">
                  {COPY.emptyBody}
                </Typography>
              </Flex>
            ) : (
              <Table colCount={3} rowCount={rows.length}>
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
                  {rows.map((row) => (
                    <Tr key={row.tempKey}>
                      <Td>
                        <TextInput
                          aria-label={COPY.colLabel}
                          value={row.key}
                          onChange={(e: any) => patchRow(row.tempKey, { key: e.target.value })}
                        />
                      </Td>
                      <Td>
                        <TextInput
                          aria-label={COPY.colLocale}
                          value={row.locale}
                          onChange={(e: any) => patchRow(row.tempKey, { locale: e.target.value })}
                        />
                      </Td>
                      <Td>
                        <Textarea
                          aria-label={COPY.colValue}
                          value={row.value}
                          rows={2}
                          onChange={(e: any) => patchRow(row.tempKey, { value: e.target.value })}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ))}
        </Layouts.Content>
      </Layouts.Root>
    </Page.Main>
  );
};

export { CopyCatalog };
export default CopyCatalog;
