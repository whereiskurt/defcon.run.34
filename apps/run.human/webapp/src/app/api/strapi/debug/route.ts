import { NextResponse } from 'next/server';
import { config } from '@/config';
import { strapiDebugSnapshot } from '@/lib/strapi';

export async function GET() {
  if (!config.cms.internalUrl) {
    return NextResponse.json(
      { error: 'CMS_INTERNAL_URL is not configured. Set it to the internal CMS worker URL.' },
      { status: 503 },
    );
  }

  try {
    const snapshot = await strapiDebugSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch CMS data' },
      { status: 502 },
    );
  }
}
