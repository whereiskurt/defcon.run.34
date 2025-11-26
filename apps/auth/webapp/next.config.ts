//@ts-check
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || 'auth.defcon.run';
const WEBAPP_PREFIX = process.env.WEBAPP_PREFIX || 'use1/assets';

const sharedConfig = {
  images: {
    remotePatterns: [new URL(`https://*.defcon.run/**`)],
  },
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
  assetPrefix: `https://${WEBAPP_ORIGIN}/${WEBAPP_PREFIX}`, // rewrites <script> / <link> tags
  turbopack: {},
};

export default process.env.NODE_ENV === 'production' ? productionConfig : sharedConfig
