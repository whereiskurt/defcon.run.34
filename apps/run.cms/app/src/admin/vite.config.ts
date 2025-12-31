// Custom Vite config for Strapi admin panel
// Sets the base path to include regional prefix for CloudFront routing
// See: https://docs.strapi.io/cms/admin-panel-customization/bundlers

import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig): UserConfig => {
  // REGION_SHORT is set during build (e.g., 'use1' or 'cac1')
  const regionShort = process.env.REGION_SHORT || '';

  // Build base path: /use1/admin/ or /cac1/admin/ (or /admin/ if no region)
  const basePath = regionShort ? `/${regionShort}/admin/` : '/admin/';

  console.log(`[vite.config] Building admin with base path: ${basePath}`);

  // Use mergeConfig to properly merge with Strapi's base config
  return mergeConfig(config, {
    base: basePath,
  });
};
