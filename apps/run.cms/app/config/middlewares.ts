export default ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:', 'https://auth.defcon.run'],
          'form-action': ["'self'", 'https://auth.defcon.run'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://cms.defcon.run',
            'https://auth.defcon.run',
            'https://*.s3.amazonaws.com',
            'https://*.s3.us-east-1.amazonaws.com',
            'https://*.s3.ca-central-1.amazonaws.com',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'https://cms.defcon.run',
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
        'https://cms.defcon.run',
        'https://run.defcon.run',
        'https://auth.defcon.run',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:1337',
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
];
