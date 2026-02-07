export default ({ env }) => {
  // Site domain from environment (defaults for local dev)
  const siteDomain = env('SITE_DOMAIN', 'defcon.run');

  // Local development ports (can be overridden via env vars)
  const LOCAL_RUN_PORT = env('LOCAL_RUN_PORT', '3001');
  const LOCAL_AUTH_PORT = env('LOCAL_AUTH_PORT', '3002');
  const LOCAL_CMS_PORT = env('LOCAL_CMS_PORT', '1337');

  return [
  'strapi::logger',
  'strapi::errors',
  // Cookie-based authentication - reads JWT from httpOnly cookie
  // Must run early, before Strapi's auth middleware
  {
    name: 'global::cookie-auth',
    config: {
      enabled: true,
    },
  },
  // Services claim validation - ensures user still has 'cms' service
  // Periodically validates against auth.{siteDomain} every 5 minutes
  // Works alongside short session lifespans for immediate revocation
  {
    name: 'global::services-validation',
    config: {
      enabled: true,
    },
  },
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:', `https://auth.${siteDomain}`],
          'form-action': ["'self'", `https://auth.${siteDomain}`],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            `https://cms.${siteDomain}`,
            `https://auth.${siteDomain}`,
            'https://*.s3.amazonaws.com',
            'https://*.s3.us-east-1.amazonaws.com',
            'https://*.s3.ca-central-1.amazonaws.com',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            `https://cms.${siteDomain}`,
            'https://*.s3.amazonaws.com',
            'https://*.s3.us-east-1.amazonaws.com',
            'https://*.s3.ca-central-1.amazonaws.com',
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      headers: '*',
      origin: [
        `https://cms.${siteDomain}`,
        `https://run.${siteDomain}`,
        `https://auth.${siteDomain}`,
        'http://localhost:3000',
        `http://localhost:${LOCAL_RUN_PORT}`,
        `http://localhost:${LOCAL_AUTH_PORT}`,
        `http://localhost:${LOCAL_CMS_PORT}`,
      ],
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      formLimit: '256mb',
      jsonLimit: '256mb',
      textLimit: '256mb',
      formidable: {
        maxFileSize: 100 * 1024 * 1024, // 100MB
      },
    },
  },
  {
    name: 'strapi::session',
    config: {
      // Session cookie config for reverse proxy setup
      // TLS terminates at CloudFront/ALB, not at Strapi
      // Since we're behind HTTPS at the edge, we can disable secure cookie check
      // The cookie is still only sent over HTTPS to the browser
      secure: false,
      sameSite: 'lax',
    },
  },
  'strapi::favicon',
  'strapi::public',
];};
