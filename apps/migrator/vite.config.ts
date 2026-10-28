import { defineConfig } from 'vite-plus';

export default defineConfig({
  // `vp pack` bundles the CLI into a single `dist/cli.mjs` for the Docker migrator
  // image. The runtime dependencies stay declared in package.json but are inlined,
  // so the image needs no `node_modules`.
  pack: {
    entry: ['src/cli.ts'],
    platform: 'node',
    deps: {
      // Patterns, not names: subpath imports such as `drizzle-orm/postgres-js`
      // must be inlined too.
      alwaysBundle: [/^drizzle-orm(\/|$)/, /^postgres$/],
    },
  },
  test: {
    name: 'migrator',
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
