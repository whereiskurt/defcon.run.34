export default ({ env }) => {
  // Get regional prefix for admin URL path
  const regionShort = env('REGION_SHORT', 'use1');

  // Debug: Log during build to verify REGION_SHORT is set
  console.log(`[admin.ts] REGION_SHORT=${regionShort}, process.env.REGION_SHORT=${process.env.REGION_SHORT}`);

  // Session lifespan configuration for OIDC re-validation
  // Short access tokens force periodic re-auth via OIDC, which re-validates
  // the 'services' claim. This ensures removed CMS access takes effect within minutes.
  const accessTokenLifespan = env.int('ADMIN_ACCESS_TOKEN_LIFESPAN', 300); // 5 minutes
  const maxRefreshTokenLifespan = env.int('ADMIN_MAX_REFRESH_LIFESPAN', 7200); // 2 hours
  const idleRefreshTokenLifespan = env.int('ADMIN_IDLE_REFRESH_LIFESPAN', 7200); // 2 hours

  return {
    // admin.url sets the path where Strapi serves the admin panel
    // STRAPI_URL = https://cms.defcon.run (no region prefix)
    // admin.url = /{region}/admin -> full URL = https://cms.defcon.run/use1/admin
    // nginx passes full path to Strapi, Strapi handles /{region}/admin/* routes
    url: `/${regionShort}/admin`,
    secrets: {
      encryptionKey: env('ADMIN_JWT_SECRET'),
    },
    auth: {
      secret: env('ADMIN_JWT_SECRET'),
      // Session management for short-lived tokens with OIDC re-validation
      // When refresh token expires, user is redirected back to OIDC flow
      // which re-validates the 'services' claim from auth.defcon.run
      sessions: {
        accessTokenLifespan, // How long before Strapi refreshes the token
        maxRefreshTokenLifespan, // Max time before full OIDC re-auth required
        idleRefreshTokenLifespan, // Idle timeout before OIDC re-auth required
        maxSessionLifespan: maxRefreshTokenLifespan, // Align with refresh lifespan
        idleSessionLifespan: idleRefreshTokenLifespan, // Align with idle refresh
      },
    },
    apiToken: {
      salt: env('API_TOKEN_SALT'),
    },
    transfer: {
      token: {
        salt: env('TRANSFER_TOKEN_SALT'),
      },
    },
    flags: {
      nps: env.bool('FLAG_NPS', false),
      promoteEE: env.bool('FLAG_PROMOTE_EE', false),
    },
  };
};
