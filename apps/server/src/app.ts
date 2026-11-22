/** Fastify application factory; injectable dependencies make route tests isolated. */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { loadConfig, type ServerConfig } from './config.js';
import authPlugin from './plugins/auth.js';
import { createPublisher, hashToken, type EventPublisher } from './lib/redis.js';
import { createUploadSigner, type UploadSigner } from './lib/s3.js';
import {
  buildHelmetCspDirectives,
  createCorsOriginHandler,
} from './lib/security.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { assetRoutes } from './routes/assets.js';
import { authRoutes } from './routes/auth.js';
import { recordRoutes } from './routes/records.js';
import { transactionRoutes } from './routes/transactions.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { v1Routes } from './api/v1/index.js';
import { AutomationEngine } from './api/v1/automations/engine.js';
import { V1EventManager } from './api/v1/events.js';
import { WebhookDispatcher } from './api/v1/webhooks/dispatcher.js';
import { createStore } from './store/index.js';
import type { DataStore } from './store/types.js';

export interface BuildServerOptions {
  config?: ServerConfig;
  store?: DataStore;
  publisher?: EventPublisher;
  uploadSigner?: UploadSigner;
  /** Overrides the HMAC webhook dispatcher (tests). */
  webhookDispatcher?: WebhookDispatcher;
  /** Overrides the automation engine (tests). */
  automationEngine?: AutomationEngine;
  /** Overrides the webhook/automation fan-out coordinator (tests). */
  v1Events?: V1EventManager;
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
  const store = options.store ?? createStore(config);
  const dispatcher =
    options.webhookDispatcher ??
    new WebhookDispatcher(store, {
      logger: {
        error: (message, meta) => fastify.log.error(meta ?? {}, message),
      },
    });
  const automationEngine =
    options.automationEngine ??
    new AutomationEngine(store, { dispatcher });
  fastify.decorate('config', config);
  fastify.decorate('store', store);
  fastify.decorate('publisher', options.publisher ?? createPublisher(config));
  fastify.decorate('uploadSigner', options.uploadSigner ?? createUploadSigner(config));
  fastify.decorate('webhookDispatcher', dispatcher);
  fastify.decorate('automationEngine', automationEngine);
  fastify.decorate(
    'v1Events',
    options.v1Events ?? new V1EventManager(dispatcher, automationEngine),
  );

  await fastify.register(cors, {
    origin: createCorsOriginHandler(config),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Notion-Version',
      'X-Request-Id',
    ],
    maxAge: 600,
  });
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: buildHelmetCspDirectives(config),
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'sameorigin' },
  });
  await fastify.register(compress);
  await fastify.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => {
      if (request.userId) {
        return `user:${request.userId}`;
      }
      const authHeader = request.headers.authorization;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return `token:${hashToken(authHeader.slice(7).trim())}`;
      }
      return `ip:${request.ip}`;
    },
  });
  await fastify.register(authPlugin);
  await fastify.register(authRoutes);
  await fastify.register(apiKeyRoutes);
  await fastify.register(transactionRoutes);
  await fastify.register(recordRoutes);
  await fastify.register(assetRoutes);
  await fastify.register(workspaceRoutes);
  await fastify.register(v1Routes, { prefix: '/v1' });

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
