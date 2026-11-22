/**
 * Fastify type augmentation: request-scoped dependencies and the JWT payload.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ServerConfig } from './config.js';
import type { EventPublisher } from './lib/redis.js';
import type { UploadSigner } from './lib/s3.js';
import type { DataStore } from './store/types.js';

/** Claims embedded in JWT access tokens. */
export interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

/** Pre-handler hook that requires a valid bearer token. */
export type AuthHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    config: ServerConfig;
    store: DataStore;
    publisher: EventPublisher;
    uploadSigner: UploadSigner;
    /** Verifies the `Authorization: Bearer <token>` header (401 on failure). */
    authenticate: AuthHook;
  }

  interface FastifyRequest {
    /** Decoded JWT payload (populated by the `authenticate` hook). */
    authUser: JwtPayload;
    /** Convenience alias for `authUser.sub`. */
    userId: string;
  }
}
