export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // server.url is the base for generating public URLs (no region prefix)
  // Since admin.url = /{region}/admin, server.url should NOT include the region prefix
  // Otherwise URLs become /use1/use1/admin (double prefix)
  // Example: server.url = https://cms.defcon.run, admin.url = /use1/admin
  //          -> admin at https://cms.defcon.run/use1/admin
  url: env('STRAPI_URL', 'https://cms.defcon.run'),
  // Trust X-Forwarded-Proto header from nginx reverse proxy
  // Required for secure cookies to work when TLS terminates at nginx
  proxy: true,
  app: {
    keys: env.array('APP_KEYS', ['defaultKey1', 'defaultKey2']),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});
