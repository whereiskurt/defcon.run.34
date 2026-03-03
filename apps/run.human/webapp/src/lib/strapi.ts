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
  fetchedAt: string;
  timing: { total: number };
}

export async function strapiDebugSnapshot(): Promise<DebugSnapshot> {
  const totalStart = Date.now();
  const snapshot: DebugSnapshot = {
    worker: { url: BASE_URL, health: null, hasToken: !!API_TOKEN },
    events: null,
    routes: null,
    pointsOfInterest: null,
    fetchedAt: new Date().toISOString(),
    timing: { total: 0 },
  };

  // Fetch health
  try {
    snapshot.worker.health = await strapiHealth();
  } catch (err) {
    snapshot.worker.error = err instanceof Error ? err.message : String(err);
  }

  // Fetch all content types in parallel with relations populated
  const populate = { populate: '*' };
  const [events, routes, pois] = await Promise.allSettled([
    strapiQuery('events', populate),
    strapiQuery('routes', populate),
    strapiQuery('points-of-interest', populate),
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

  snapshot.timing.total = Date.now() - totalStart;
  return snapshot;
}
