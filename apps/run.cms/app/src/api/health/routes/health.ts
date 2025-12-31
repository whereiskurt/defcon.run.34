/**
 * Health check routes
 * Provides /_health endpoint for load balancer health checks
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/_health',
      handler: 'health.check',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
