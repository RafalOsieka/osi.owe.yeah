import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/*.ts',
  casing: 'snake_case',
  // The schema lives here, but the committed migrations belong to the migrator app,
  // which applies them (`vp run db:migrate`). Generating needs no database.
  out: '../migrator/migrations',
});
