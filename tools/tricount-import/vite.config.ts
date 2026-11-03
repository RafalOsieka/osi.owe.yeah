import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    name: 'tricount-import',
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
