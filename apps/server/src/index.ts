/** Votion Fastify API server entrypoint. */

import { buildServer } from './app.js';
import { loadConfig } from './config.js';

/** Backend service identifier. */
export const SERVER_NAME = 'votion-server';
/** Backend service version. */
export const SERVER_VERSION = '0.1.0';
/** Returns the service identifier used by health checks. */
export function getServerId(): string {
  return `${SERVER_NAME}@${SERVER_VERSION}`;
}

/** Starts the HTTP API and installs graceful process shutdown handlers. */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down gracefully');
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ err: error }, 'graceful shutdown failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({ port: config.PORT, host: config.HOST });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startServer().catch((error: unknown) => {
    console.error('Failed to start Votion API server:', error);
    process.exitCode = 1;
  });
}
