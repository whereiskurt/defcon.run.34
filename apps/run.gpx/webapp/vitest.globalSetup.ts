import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Ensure gpx-studio has a resolvable tsconfig before any test transforms it.
 *
 * Two suites (`strava-strip-pure.test.ts`, `checkin-cluster.test.ts`) import
 * PURE modules out of gpx-studio, because the studio has no test runner of its
 * own and the alternative is leaving that logic untested. The studio's
 * `tsconfig.json` extends `./.svelte-kit/tsconfig.json`, which SvelteKit only
 * generates during a build — so in a fresh checkout it does not exist and the
 * transform dies with TSCONFIG_ERROR before a single test runs. (That is why
 * `strava-strip-pure.test.ts` had been silently failing.)
 *
 * `.svelte-kit/` is gitignored and entirely build-generated, so writing a
 * minimal stub here is safe: a real `svelte-kit sync` overwrites it during the
 * actual frontend build, and nothing ships out of this directory.
 */
const STUDIO = fileURLToPath(new URL("../gpx-studio/website", import.meta.url));

const STUB = {
  compilerOptions: {
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext", "DOM", "DOM.Iterable"],
    strict: true,
    skipLibCheck: true,
    allowJs: true,
    esModuleInterop: true,
    resolveJsonModule: true,
  },
};

export default function setup() {
  const dir = `${STUDIO}/.svelte-kit`;
  const tsconfig = `${dir}/tsconfig.json`;
  if (existsSync(tsconfig)) return;

  mkdirSync(dir, { recursive: true });
  writeFileSync(tsconfig, JSON.stringify(STUB, null, 2));
}
