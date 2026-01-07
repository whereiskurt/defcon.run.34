export default ({ env }) => {
  const s3AccessKey = env('S3_MEDIA_ACCESS_KEY');
  const s3Bucket = env('S3_MEDIA_BUCKET');
  const regionShort = env('REGION_SHORT', 'use1');

  // CloudFront CDN base URL (domain only, no path)
  // The rootPath will be appended to construct full URLs
  const cdnBaseUrl = 'https://cms.defcon.run';

  // S3 root path - upload files to {region}/cms/ folder so CloudFront paths match
  // e.g., use1/cms/image.png maps to https://cms.defcon.run/use1/cms/image.png
  const s3RootPath = `${regionShort}/cms`;

  // Only configure S3 if credentials are provided
  const uploadConfig = s3AccessKey && s3Bucket
    ? {
        config: {
          provider: '@strapi/provider-upload-aws-s3',
          providerOptions: {
            accessKeyId: s3AccessKey,
            secretAccessKey: env('S3_MEDIA_SECRET_KEY'),
            region: env('S3_MEDIA_REGION', 'us-east-1'),
            params: {
              Bucket: s3Bucket,
              ACL: null, // Bucket policy handles access
            },
            rootPath: s3RootPath, // Upload to {region}/cms/ folder
            baseUrl: cdnBaseUrl, // Serve assets via CloudFront CDN
          },
          actionOptions: {
            upload: {},
            uploadStream: {},
            delete: {},
          },
        },
      }
    : {}; // Use default local provider

  // Configure SES using AWS SDK v3 (IAM role on Fargate, local profile)
  const emailConfig = {
    config: {
      provider: 'strapi-provider-email-aws-ses-v3',
      providerOptions: {
        region: env('AWS_REGION', 'us-east-1'),
        // Uses default AWS credential chain - IAM role in production, profile locally
      },
      settings: {
        defaultFrom: env('SES_FROM_ADDRESS', 'cms@defcon.run'),
        defaultReplyTo: env('SES_REPLYTO_ADDRESS', 'cms@defcon.run'),
      },
    },
  };

  // Users & Permissions plugin - requires jwtSecret for authentication tokens
  const usersPermissionsConfig = {
    config: {
      jwtSecret: env('JWT_SECRET'),
    },
  };

  // SSO plugin configuration for OIDC authentication via auth.defcon.run
  const isDev = env('NODE_ENV') === 'development';

  // OIDC endpoints - regional in production, local in development
  const oidcBaseUrl = isDev
    ? 'http://localhost:3002/api/oidc'
    : `https://auth.defcon.run/${regionShort}/api/oidc`;

  const ssoConfig = {
    enabled: true,
    config: {
      // Use localStorage instead of cookies for better session persistence
      REMEMBER_ME: true,
      // OIDC provider configuration
      OIDC_CLIENT_ID: env('STRAPI_OIDC_CLIENT_ID'),
      OIDC_CLIENT_SECRET: env('STRAPI_OIDC_CLIENT_SECRET'),
      OIDC_REDIRECT_URI: env('OIDC_REDIRECT_URI',
        isDev
          ? 'http://localhost:1337/strapi-plugin-sso/oidc/callback'
          : `https://cms.defcon.run/${regionShort}/strapi-plugin-sso/oidc/callback`
      ),
      OIDC_SCOPES: 'openid profile email services',
      OIDC_AUTHORIZATION_ENDPOINT: env('OIDC_AUTHORIZATION_ENDPOINT', `${oidcBaseUrl}/auth`),
      OIDC_TOKEN_ENDPOINT: env('OIDC_TOKEN_ENDPOINT', `${oidcBaseUrl}/token`),
      OIDC_USER_INFO_ENDPOINT: env('OIDC_USER_INFO_ENDPOINT', `${oidcBaseUrl}/me`),
      OIDC_GRANT_TYPE: 'authorization_code',
      // Use Authorization header for userinfo endpoint (required by oidc-provider)
      OIDC_USER_INFO_ENDPOINT_WITH_AUTH_HEADER: true,
      // Custom claim field mappings for name parsing
      // auth.defcon.run returns 'name' as full name, plugin needs to split it
      OIDC_FAMILY_NAME_FIELD: 'family_name',
      OIDC_GIVEN_NAME_FIELD: 'given_name',
    },
  };

  return {
    upload: uploadConfig,
    email: emailConfig,
    'users-permissions': usersPermissionsConfig,
    'strapi-plugin-sso': ssoConfig,
  };
};
