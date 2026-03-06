import { config } from '@/config';

const BASE_URL = config.cms.internalUrl;
const API_TOKEN = config.cms.apiToken;

function headers(): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (API_TOKEN) {
    h['Authorization'] = `Bearer ${API_TOKEN}`;
  }
  return h;
}

export async function strapiHealth(): Promise<{
  status: string;
  mode?: string;
  region?: string;
  timestamp: string;
  responseTime: number;
}> {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/_health`, {
    headers: headers(),
    cache: 'no-store',
  });
  const responseTime = Date.now() - start;

  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status} ${res.statusText}`);
  }

  // Strapi /_health returns 204 No Content — handle empty body
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return {
    status: data.status || 'ok',
    mode: data.mode,
    region: data.region,
    timestamp: new Date().toISOString(),
    responseTime,
  };
}

export async function strapiQuery(
  contentType: string,
  params?: Record<string, string>,
): Promise<{ data: unknown[]; meta: unknown; responseTime: number }> {
  const start = Date.now();
  const url = new URL(`${BASE_URL}/api/${contentType}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: headers(),
    cache: 'no-store',
  });
  const responseTime = Date.now() - start;

  if (!res.ok) {
    throw new Error(`Strapi query ${contentType} failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return { data: json.data || [], meta: json.meta || {}, responseTime };
}

export interface ContentResult {
  data: unknown[];
  meta: unknown;
  responseTime: number;
  error?: string;
}

export interface MediaFile {
  id: number;
  name: string;
  url: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  provider: string;
  provider_metadata?: unknown;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MediaResult {
  data: MediaFile[];
  responseTime: number;
  error?: string;
}

export interface DebugSnapshot {
  worker: {
    url: string;
    health: { status: string; mode?: string; region?: string; timestamp: string; responseTime: number } | null;
    error?: string;
    hasToken: boolean;
  };
  events: ContentResult | null;
  routes: ContentResult | null;
  pointsOfInterest: ContentResult | null;
  media: MediaResult | null;
  fetchedAt: string;
  timing: { total: number };
}

export async function strapiMediaFiles(): Promise<MediaResult> {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/upload/files`, {
    headers: headers(),
    cache: 'no-store',
  });
  const responseTime = Date.now() - start;

  if (!res.ok) {
    throw new Error(`Media query failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return { data: json || [], responseTime };
}

export async function strapiDebugSnapshot(): Promise<DebugSnapshot> {
  const totalStart = Date.now();
  const snapshot: DebugSnapshot = {
    worker: { url: BASE_URL, health: null, hasToken: !!API_TOKEN },
    events: null,
    routes: null,
    pointsOfInterest: null,
    media: null,
    fetchedAt: new Date().toISOString(),
    timing: { total: 0 },
  };

  // Fetch health
  try {
    snapshot.worker.health = await strapiHealth();
  } catch (err) {
    snapshot.worker.error = err instanceof Error ? err.message : String(err);
  }

  // Fetch all content types and media in parallel
  const populate = { populate: '*' };
  const [events, routes, pois, media] = await Promise.allSettled([
    strapiQuery('events', populate),
    strapiQuery('routes', populate),
    strapiQuery('points-of-interest', populate),
    strapiMediaFiles(),
  ]);

  snapshot.events = events.status === 'fulfilled'
    ? events.value
    : { data: [], meta: {}, responseTime: 0, error: events.reason?.message || String(events.reason) };
  snapshot.routes = routes.status === 'fulfilled'
    ? routes.value
    : { data: [], meta: {}, responseTime: 0, error: routes.reason?.message || String(routes.reason) };
  snapshot.pointsOfInterest = pois.status === 'fulfilled'
    ? pois.value
    : { data: [], meta: {}, responseTime: 0, error: pois.reason?.message || String(pois.reason) };
  snapshot.media = media.status === 'fulfilled'
    ? media.value
    : { data: [], responseTime: 0, error: media.reason?.message || String(media.reason) };

  snapshot.timing.total = Date.now() - totalStart;
  return snapshot;
}
