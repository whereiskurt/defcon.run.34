/**
 * Health check controller for CMS
 * Responds to /_health endpoint for load balancer health checks
 */

export default {
  async check(ctx) {
    const mode = process.env.CMS_MODE || 'unknown';
    const region = process.env.REGION_SHORT || 'unknown';

    ctx.body = {
      status: 'ok',
      mode,
      region,
      timestamp: new Date().toISOString(),
    };
  },
};
