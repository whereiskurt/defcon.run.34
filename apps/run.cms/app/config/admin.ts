import { Strategy as OIDCStrategy } from 'passport-openidconnect';

export default ({ env }) => {
  // Get regional prefix for admin URL path
  const regionShort = env('REGION_SHORT', 'use1');
  const strapiUrl = env('STRAPI_URL', 'https://cms.defcon.run');
  const isDev = env('NODE_ENV') === 'development';

  // OIDC issuer URL - auth.defcon.run with regional prefix in production
  const oidcIssuer = isDev
    ? 'http://localhost:3000/api/oidc'
    : `https://auth.defcon.run/${regionShort}/api/oidc`;

  // Callback URL for OIDC - includes regional prefix
  const callbackUrl = isDev
    ? 'http://localhost:1337/admin/connect/oidc/callback'
    : `${strapiUrl}/${regionShort}/admin/connect/oidc/callback`;

  return {
    // admin.url sets the path where Strapi serves the admin panel
    // STRAPI_URL = https://cms.defcon.run (no region prefix)
    // admin.url = /{region}/admin -> full URL = https://cms.defcon.run/use1/admin
    // nginx passes full path to Strapi, Strapi handles /{region}/admin/* routes
    url: `/${regionShort}/admin`,
    auth: {
      secret: env('ADMIN_JWT_SECRET'),
      providers: [
        {
          uid: 'oidc',
          displayName: 'DEFCON.run',
          icon: 'https://auth.defcon.run/favicon.ico',
          createStrategy: (strapi) =>
            new OIDCStrategy(
              {
                issuer: oidcIssuer,
                authorizationURL: `${oidcIssuer}/auth`,
                tokenURL: `${oidcIssuer}/token`,
                userInfoURL: `${oidcIssuer}/me`,
                clientID: env('STRAPI_OIDC_CLIENT_ID'),
                clientSecret: env('STRAPI_OIDC_CLIENT_SECRET'),
                callbackURL: callbackUrl,
                scope: ['openid', 'profile', 'email', 'services'],
              },
              (
                issuer: string,
                profile: { id?: string; displayName?: string; name?: { familyName?: string; givenName?: string }; emails?: Array<{ value: string }>; _json?: { services?: string[]; email?: string } },
                done: (err: Error | null, user?: { email: string; firstname: string; lastname: string } | false) => void
              ) => {
                // Extract services claim from profile
                const services: string[] = profile._json?.services || [];

                // Check if user has CMS access
                if (!services.includes('cms')) {
                  return done(
                    new Error(
                      'Access denied: Your account does not have CMS access. ' +
                      'Please contact an administrator to request CMS permissions.'
                    )
                  );
                }

                // Extract user info from OIDC claims
                const email = profile.emails?.[0]?.value || profile._json?.email || '';
                const firstname = profile.name?.givenName || profile.displayName?.split(' ')[0] || 'User';
                const lastname = profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';

                // Return user data for Strapi admin creation/lookup
                done(null, {
                  email,
                  firstname,
                  lastname,
                });
              }
            ),
        },
      ],
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
