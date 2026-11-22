/** Fastify application factory; injectable dependencies make route tests isolated. */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { loadConfig, type ServerConfig } from './config.js';
import authPlugin from './plugins/auth.js';
import { createPublisher, type EventPublisher } from './lib/redis.js';
import { createUploadSigner, type UploadSigner } from './lib/s3.js';
import { assetRoutes } from './routes/assets.js';
import { authRoutes } from './routes/auth.js';
import { recordRoutes } from './routes/records.js';
import { transactionRoutes } from './routes/transactions.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { createStore } from './store/index.js';
import type { DataStore } from './store/types.js';

export interface BuildServerOptions {
  config?: ServerConfig;
  store?: DataStore;
  publisher?: EventPublisher;
  uploadSigner?: UploadSigner;
  logger?: boolean;
}

/** Creates a configured but not-yet-listening API server. */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const fastify = Fastify({
    logger: options.logger ?? config.NODE_ENV !== 'test',
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  fastify.decorate('config', config);
  fastify.decorate('store', options.store ?? createStore(config));
  fastify.decorate('publisher', options.publisher ?? createPublisher(config));
  fastify.decorate('uploadSigner', options.uploadSigner ?? createUploadSigner(config));

  await fastify.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(compress);
  await fastify.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.userId ?? request.ip,
  });
  await fastify.register(authPlugin);
  await fastify.register(authRoutes);
  await fastify.register(transactionRoutes);
  await fastify.register(recordRoutes);
  await fastify.register(assetRoutes);
  await fastify.register(workspaceRoutes);

  fastify.get('/health', async () => ({ ok: true, service: 'votion-server' }));

  fastify.setErrorHandler((error: import('fastify').FastifyError, _request, reply) => {
    fastify.log.error({ err: error }, 'request failed');
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : error.name,
      message: statusCode === 500 ? 'An unexpected error occurred.' : error.message,
    });
  });

  fastify.addHook('onClose', async () => {
    await Promise.allSettled([
      fastify.store.close(),
      fastify.publisher.close(),
      fastify.uploadSigner.close(),
    ]);
  });
  return fastify;
}
