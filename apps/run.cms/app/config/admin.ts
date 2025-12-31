export default ({ env }) => {
  // admin.url is relative to server.url (STRAPI_URL)
  // STRAPI_URL already includes the regional prefix: https://cms.defcon.run/use1
  // So admin.url just needs to be /admin, resulting in https://cms.defcon.run/use1/admin
  return {
    url: '/admin',
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
