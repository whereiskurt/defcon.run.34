//@ts-check
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || 'run.defcon.run';
const WEBAPP_PREFIX = process.env.WEBAPP_PREFIX || 'use1/assets';
const REGION_SHORT = process.env.REGION_SHORT || 'use1';

// Read VERSION files at build time
const readVersion = (path: string): string => {
  try {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8').trim();
    }
  } catch {}
  return 'unknown';
};

const VERSION_APP = process.env.NEXT_PUBLIC_VERSION_APP || readVersion(resolve(__dirname, 'VERSION'));
const VERSION_NGINX = process.env.NEXT_PUBLIC_VERSION_NGINX || readVersion(resolve(__dirname, '../nginx/VERSION'));

const sharedConfig = {
  env: {
    NEXT_PUBLIC_VERSION_APP: VERSION_APP,
    NEXT_PUBLIC_VERSION_NGINX: VERSION_NGINX,
    NEXT_PUBLIC_REGION_SHORT: REGION_SHORT,
  },
  turbopack: {
    root: __dirname, // Silence the workspace root warning
  },
  images: {
    remotePatterns: [new URL(`https://*.defcon.run/**`)],
  },
  allowedDevOrigins: ['local://*', '*.local', '192.168.*.*'],
  async redirects() {
    return [
      {
        source: '/meshtk',
        destination: 'https://github.com/whereiskurt/meshtk',
        permanent: true,
      }
    ];
  }
};

const productionConfig = {
  ...sharedConfig,
  output: 'standalone',
  basePath: `/${REGION_SHORT}`, // Mount app at /{region} path (e.g., /use1 or /cac1)
  assetPrefix: `https://${WEBAPP_ORIGIN}/${WEBAPP_PREFIX}`, // rewrites <script> / <link> tags
  turbopack: {
    root: __dirname, // Silence the workspace root warning
  },
};

export default process.env.NODE_ENV === 'production' ? productionConfig : sharedConfig
