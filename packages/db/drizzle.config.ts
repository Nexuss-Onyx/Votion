import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for the Votion PostgreSQL schema.
 *
 * `drizzle-kit generate` / `check` run fully offline against the TypeScript
 * schema; only `migrate`, `push` and `studio` require a live database.
 *
 * Never commit a real connection string — `DATABASE_URL` is supplied by the
 * environment (or CI secrets) and the fallback below is a local placeholder.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/votion?sslmode=disable',
  },
  verbose: true,
  strict: false,
});
