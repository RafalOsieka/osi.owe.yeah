import { join } from 'node:path';
import { addVitePlugin, defineNuxtModule } from 'nuxt/kit';

// A folder of its own in the client build, served at the root.
const dir = 'licenses';

/**
 * Serves the licenses of the client bundle's dependencies at `/licenses.txt`, as minifying
 * strips their notices from the JavaScript every visitor downloads. Vite's `build.license`
 * writes the file: each bundled package with its license text, as markdown. Nuxt serves
 * only the client build's `_nuxt/` folder, with a year-long immutable cache, which a file
 * that keeps its name across builds can't have; so it goes to a folder of its own, added
 * to Nitro's public assets.
 */
export default defineNuxtModule({
  meta: { name: 'client-licenses' },
  setup(_options, nuxt) {
    addVitePlugin({
      name: 'owe-yeah:client-licenses',
      configEnvironment: (name) =>
        name === 'client' ? { build: { license: { fileName: `${dir}/licenses.txt` } } } : undefined,
    });
    nuxt.hook('nitro:config', (config) => {
      config.publicAssets ??= [];
      // No cache lifetime: the file keeps its name across builds.
      config.publicAssets.push({ dir: join(nuxt.options.buildDir, 'dist/client', dir), maxAge: 0 });
    });
  },
});
