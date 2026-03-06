'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  Card,
  CardHeader,
  CardBody,
  Button,
  Chip,
  Skeleton,
  Switch,
} from '@heroui/react';
import { RefreshCw, Database, Activity, MapPin, Route, Calendar, AlertCircle, Image } from 'lucide-react';
import { apiUrl } from '@/lib/api';

interface ContentItem {
  id: number;
  documentId?: string;
  [key: string]: unknown;
}

interface ContentResult {
  data: ContentItem[];
  meta: unknown;
  responseTime: number;
  error?: string;
}

interface DebugData {
  worker: {
    url: string;
    health: {
      status: string;
      mode?: string;
      region?: string;
      timestamp: string;
      responseTime: number;
    } | null;
    error?: string;
    hasToken: boolean;
  };
  events: ContentResult | null;
  routes: ContentResult | null;
  pointsOfInterest: ContentResult | null;
  media: {
    data: Array<{
      id: number;
      name: string;
      url: string;
      mime: string;
      size: number;
      provider: string;
      provider_metadata?: unknown;
      createdAt: string;
      updatedAt: string;
      [key: string]: unknown;
    }>;
    responseTime: number;
    error?: string;
  } | null;
  fetchedAt: string;
  timing: { total: number };
}

const AUTO_REFRESH_OPTIONS = [
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
];

export default function StrapiDebugPage() {
  const { status } = useSession();
  const [data, setData] = useState<DebugData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDebug = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/strapi/debug'));
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDebug();
  }, [fetchDebug]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchDebug, refreshInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refreshInterval, fetchDebug]);

  if (status === 'loading') {
    return (
      <div className="space-y-4 py-8">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-museo text-2xl font-bold">Strapi Debug</h1>
          <p className="text-sm text-default-500">
            Internal CMS worker query diagnostics
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              isSelected={autoRefresh}
              onValueChange={setAutoRefresh}
            />
            <span className="text-sm text-default-500">Auto</span>
            {autoRefresh && (
              <div className="flex gap-1">
                {AUTO_REFRESH_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={refreshInterval === opt.value ? 'solid' : 'flat'}
                    color={refreshInterval === opt.value ? 'primary' : 'default'}
                    onPress={() => setRefreshInterval(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="flat"
            startContent={<RefreshCw className="h-4 w-4" />}
            onPress={() => { setLoading(true); fetchDebug(); }}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-danger-50 border border-danger-200 text-danger-700 px-4 py-3 rounded-lg">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </span>
        </div>
      )}

      {/* Last fetched */}
      {data && (
        <div className="text-sm text-default-400">
          Last fetched: <span className="font-mono text-default-600">{new Date(data.fetchedAt).toLocaleString()}</span>
          {' '} | Total: <span className="font-mono text-default-600">{data.timing.total}ms</span>
        </div>
      )}

      {/* Connection card */}
      <Card className="glass-card">
        <CardHeader className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <span className="font-museo font-bold">Worker Connection</span>
        </CardHeader>
        <CardBody>
          {loading && !data ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : data ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-default-500 w-24">URL</span>
                <code className="text-sm font-mono bg-default-100 px-2 py-1 rounded">{data.worker.url}</code>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-default-500 w-24">Status</span>
                {data.worker.health ? (
                  <Chip color="success" size="sm" variant="flat">{data.worker.health.status}</Chip>
                ) : (
                  <Chip color="danger" size="sm" variant="flat">unreachable</Chip>
                )}
              </div>
              {data.worker.health?.mode && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-default-500 w-24">Mode</span>
                  <Chip color="primary" size="sm" variant="flat">{data.worker.health.mode}</Chip>
                </div>
              )}
              {data.worker.health?.region && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-default-500 w-24">Region</span>
                  <Chip color="secondary" size="sm" variant="flat">{data.worker.health.region}</Chip>
                </div>
              )}
              {data.worker.health && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-default-500 w-24">Response</span>
                  <span className="text-sm font-mono">{data.worker.health.responseTime}ms</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="text-sm text-default-500 w-24">API Token</span>
                {data.worker.hasToken ? (
                  <Chip color="success" size="sm" variant="flat">configured</Chip>
                ) : (
                  <Chip color="danger" size="sm" variant="flat">missing</Chip>
                )}
              </div>
              {data.worker.error && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-default-500 w-24">Error</span>
                  <span className="text-sm text-danger">{data.worker.error}</span>
                </div>
              )}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Content cards */}
      <div className="grid gap-4">
        <ContentCard
          title="Events"
          icon={<Calendar className="h-5 w-5 text-warning" />}
          result={data?.events}
          loading={loading && !data}
          fields={['title', 'slug', 'type', 'updatedAt']}
        />
        <ContentCard
          title="Routes"
          icon={<Route className="h-5 w-5 text-success" />}
          result={data?.routes}
          loading={loading && !data}
          fields={['name', 'slug', 'distance', 'updatedAt']}
        />
        <ContentCard
          title="Points of Interest"
          icon={<MapPin className="h-5 w-5 text-primary" />}
          result={data?.pointsOfInterest}
          loading={loading && !data}
          fields={['name', 'slug', 'type', 'updatedAt']}
        />
      </div>

      {/* Media Library */}
      <Card className="glass-card">
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image className="h-5 w-5 text-secondary" />
            <span className="font-museo font-bold">Media Library</span>
          </div>
          {data?.media && (
            <div className="flex items-center gap-2">
              <Chip size="sm" variant="flat">{data.media.data.length} files</Chip>
              <span className="text-xs text-default-400 font-mono">{data.media.responseTime}ms</span>
            </div>
          )}
        </CardHeader>
        <CardBody>
          {loading && !data ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : data?.media?.error ? (
            <div className="text-sm text-danger font-mono">{data.media.error}</div>
          ) : data?.media?.data.length === 0 ? (
            <div className="text-sm text-default-400">No media files found</div>
          ) : data?.media ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-default-200">
                    <th className="text-left py-2 px-2 text-default-500 font-normal">ID</th>
                    <th className="text-left py-2 px-2 text-default-500 font-normal">name</th>
                    <th className="text-left py-2 px-2 text-default-500 font-normal">mime</th>
                    <th className="text-left py-2 px-2 text-default-500 font-normal">size</th>
                    <th className="text-left py-2 px-2 text-default-500 font-normal">url</th>
                    <th className="text-left py-2 px-2 text-default-500 font-normal">provider</th>
                  </tr>
                </thead>
                <tbody>
                  {data.media.data.map((file) => (
                    <tr key={file.id} className="border-b border-default-100">
                      <td className="py-2 px-2 font-mono text-xs">{file.id}</td>
                      <td className="py-2 px-2 text-xs max-w-48 truncate">{file.name}</td>
                      <td className="py-2 px-2 text-xs">{file.mime}</td>
                      <td className="py-2 px-2 text-xs font-mono">{(file.size / 1024).toFixed(1)}KB</td>
                      <td className="py-2 px-2 text-xs max-w-64 truncate font-mono">{file.url}</td>
                      <td className="py-2 px-2 text-xs">{file.provider}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Relations card */}
      {data && (data.events?.data.length || data.routes?.data.length || data.pointsOfInterest?.data.length) ? (
        <Card className="glass-card">
          <CardHeader className="flex items-center gap-2">
            <Database className="h-5 w-5 text-secondary" />
            <span className="font-museo font-bold">Relations</span>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              {data.events?.data.map((event: ContentItem) => (
                <div key={event.id} className="border border-default-200 rounded-lg p-3">
                  <div className="font-museo font-bold text-sm mb-2">
                    {String(event.title || event.name || `Event #${event.id}`)}
                  </div>
                  {Array.isArray(event.routes) && (event.routes as ContentItem[]).length > 0 && (
                    <div className="ml-4 space-y-2">
                      {(event.routes as ContentItem[]).map((route: ContentItem) => (
                        <div key={route.id} className="flex items-start gap-2">
                          <Route className="h-3 w-3 mt-1 text-success" />
                          <div>
                            <span className="text-sm">{String(route.title || route.name || `Route #${route.id}`)}</span>
                            {Array.isArray(route.points_of_interest) && (
                              <div className="ml-4 flex flex-wrap gap-1 mt-1">
                                {(route.points_of_interest as ContentItem[]).map((poi: ContentItem) => (
                                  <Chip key={poi.id} size="sm" variant="flat" color="primary">
                                    {String(poi.name || `POI #${poi.id}`)}
                                  </Chip>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function ContentCard({
  title,
  icon,
  result,
  loading,
  fields,
}: {
  title: string;
  icon: React.ReactNode;
  result: ContentResult | null | undefined;
  loading: boolean;
  fields: string[];
}) {
  return (
    <Card className="glass-card">
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-museo font-bold">{title}</span>
        </div>
        {result && (
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="flat">{result.data.length} items</Chip>
            <span className="text-xs text-default-400 font-mono">{result.responseTime}ms</span>
          </div>
        )}
      </CardHeader>
      <CardBody>
        {loading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : result === null || result === undefined ? (
          <div className="text-sm text-default-400">Failed to fetch or not configured</div>
        ) : result.error ? (
          <div className="text-sm text-danger font-mono">{result.error}</div>
        ) : result.data.length === 0 ? (
          <div className="text-sm text-default-400">No {title.toLowerCase()} found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default-200">
                  <th className="text-left py-2 px-2 text-default-500 font-normal">ID</th>
                  {fields.map((f) => (
                    <th key={f} className="text-left py-2 px-2 text-default-500 font-normal">{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.map((item: ContentItem) => (
                  <tr key={item.id} className="border-b border-default-100">
                    <td className="py-2 px-2 font-mono text-xs">{item.id}</td>
                    {fields.map((f) => (
                      <td key={f} className="py-2 px-2 text-xs">
                        {f === 'updatedAt' && item[f]
                          ? new Date(String(item[f])).toLocaleString()
                          : String(item[f] ?? '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
