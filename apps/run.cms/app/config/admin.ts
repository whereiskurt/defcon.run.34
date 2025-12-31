export default ({ env }) => {
  // Get regional prefix for admin URL path
  const regionShort = env('REGION_SHORT', 'use1');

  return {
    // admin.url sets the path where Strapi serves the admin panel
    // STRAPI_URL = https://cms.defcon.run (no region prefix)
    // admin.url = /{region}/admin -> full URL = https://cms.defcon.run/use1/admin
    // nginx passes full path to Strapi, Strapi handles /{region}/admin/* routes
    url: `/${regionShort}/admin`,
    auth: {
      secret: env('ADMIN_JWT_SECRET'),
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
