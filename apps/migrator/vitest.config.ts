import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    name: 'migrator',
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
