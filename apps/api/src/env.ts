import { fileURLToPath } from 'node:url';

/** Loads the repo-root .env (DATABASE_URL and friends) when there is one. */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: rely on the real environment.
}
