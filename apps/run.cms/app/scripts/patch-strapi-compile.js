#!/usr/bin/env node
/**
 * Patches @strapi/typescript-utils to copy schema.json files after TS compilation
 * This works around a "bug"/ts setup issue in Strapi 5 where JSON files aren't copied to dist
 */
const fs = require('fs');
const path = require('path');

const compilerPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@strapi',
  'typescript-utils',
  'lib',
  'compilers',
  'basic.js'
);

const originalContent = fs.readFileSync(compilerPath, 'utf8');

// Check if already patched (v2 includes components)
if (originalContent.includes('// PATCHED: Copy schema.json and component files')) {
  console.log('[patch] Already patched');
  process.exit(0);
}

// Remove old v1 patch marker if present (re-patch with v2)
const needsRepatch = originalContent.includes('// PATCHED: Copy schema.json files') &&
                     !originalContent.includes('// PATCHED: Copy schema.json and component files');

// Add the copy function after the emit
// If we need to re-patch, restore the original first
const baseContent = needsRepatch
  ? originalContent.replace(/\n\n    \/\/ PATCHED: Copy schema\.json files[\s\S]*?copySchemas\(\);/, '')
  : originalContent;

const patchedContent = baseContent.replace(
  'const emitResults = program.emit();',
  `const emitResults = program.emit();

    // PATCHED: Copy schema.json and component files to dist
    const copyJsonFiles = () => {
      const fs = require('fs');
      const path = require('path');
      const outDir = compilerOptions.outDir;
      if (!outDir) return;

      const projectRoot = path.dirname(tsConfigPath);

      // Copy schema.json files from src/api/
      const srcApi = path.join(projectRoot, 'src', 'api');
      if (fs.existsSync(srcApi)) {
        const copyRecursive = (src, dest, filter) => {
          const entries = fs.readdirSync(src, { withFileTypes: true });
          for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              copyRecursive(srcPath, destPath, filter);
            } else if (filter(entry.name)) {
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              fs.copyFileSync(srcPath, destPath);
            }
          }
        };
        copyRecursive(srcApi, path.join(outDir, 'src', 'api'), (name) => name === 'schema.json');
      }

      // Copy component JSON files from src/components/
      const srcComponents = path.join(projectRoot, 'src', 'components');
      if (fs.existsSync(srcComponents)) {
        const copyJsonRecursive = (src, dest) => {
          const entries = fs.readdirSync(src, { withFileTypes: true });
          for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              copyJsonRecursive(srcPath, destPath);
            } else if (entry.name.endsWith('.json')) {
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              fs.copyFileSync(srcPath, destPath);
            }
          }
        };
        copyJsonRecursive(srcComponents, path.join(outDir, 'src', 'components'));
      }
    };
    copyJsonFiles();`
);

fs.writeFileSync(compilerPath, patchedContent);
console.log('[patch] Successfully patched @strapi/typescript-utils to copy schema.json and component files');
