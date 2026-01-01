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

// Check if already patched
if (originalContent.includes('// PATCHED: Copy schema.json files')) {
  console.log('[patch] Already patched');
  process.exit(0);
}

// Add the copy function after the emit
const patchedContent = originalContent.replace(
  'const emitResults = program.emit();',
  `const emitResults = program.emit();

    // PATCHED: Copy schema.json files to dist
    const copySchemas = () => {
      const fs = require('fs');
      const path = require('path');
      const outDir = compilerOptions.outDir;
      if (!outDir) return;

      const srcApi = path.join(path.dirname(tsConfigPath), 'src', 'api');
      if (!fs.existsSync(srcApi)) return;

      const copyRecursive = (src, dest) => {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
          } else if (entry.name === 'schema.json') {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };

      const distApi = path.join(outDir, 'src', 'api');
      copyRecursive(srcApi, distApi);
    };
    copySchemas();`
);

fs.writeFileSync(compilerPath, patchedContent);
console.log('[patch] Successfully patched @strapi/typescript-utils to copy schema.json files');
