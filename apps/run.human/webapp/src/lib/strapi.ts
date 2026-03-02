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

  const data = await res.json();
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

export interface DebugSnapshot {
  worker: {
    url: string;
    health: { status: string; mode?: string; region?: string; timestamp: string; responseTime: number } | null;
    error?: string;
  };
  events: { data: unknown[]; meta: unknown; responseTime: number } | null;
  routes: { data: unknown[]; meta: unknown; responseTime: number } | null;
  pointsOfInterest: { data: unknown[]; meta: unknown; responseTime: number } | null;
  fetchedAt: string;
  timing: { total: number };
}

export async function strapiDebugSnapshot(): Promise<DebugSnapshot> {
  const totalStart = Date.now();
  const snapshot: DebugSnapshot = {
    worker: { url: BASE_URL, health: null },
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

  if (events.status === 'fulfilled') snapshot.events = events.value;
  if (routes.status === 'fulfilled') snapshot.routes = routes.value;
  if (pois.status === 'fulfilled') snapshot.pointsOfInterest = pois.value;

  snapshot.timing.total = Date.now() - totalStart;
  return snapshot;
}
