import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    name: 'domain',
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
