// scripts/make-bunny-alpha.mjs — one-time: luminance -> alpha, pixels forced white.
import fs from 'node:fs';
import { PNG } from 'pngjs';

const src = PNG.sync.read(fs.readFileSync('public/header/bunny-head.png'));
const out = new PNG({ width: src.width, height: src.height });
for (let i = 0; i < src.data.length; i += 4) {
  const lum = Math.round(
    0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2]
  );
  out.data[i] = 255;
  out.data[i + 1] = 255;
  out.data[i + 2] = 255;
  out.data[i + 3] = lum;
}
fs.writeFileSync('public/header/bunny-head-alpha.png', PNG.sync.write(out));
const opaque = [...out.data].filter((_, i) => i % 4 === 3 && out.data[i] > 200).length;
console.log(`wrote bunny-head-alpha.png ${out.width}x${out.height}, bright px: ${opaque}`);
