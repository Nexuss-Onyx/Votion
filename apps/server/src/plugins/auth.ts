/**
 * Authentication plugin.
 *
 * Registers `@fastify/jwt` and decorates the instance with `authenticate`, a
 * pre-handler hook that verifies `Authorization: Bearer <accessToken>` and
 * populates `request.authUser` / `request.userId`. Access tokens are
 * short-lived (15 minutes by default); long-lived sessions use rotating
 * opaque refresh tokens (see `routes/auth.ts`).
 */

import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { JwtPayload } from '../types.js';

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(jwt, {
    secret: fastify.config.JWT_SECRET ?? 'insecure-test-secret',
    sign: { expiresIn: fastify.config.JWT_ACCESS_TTL },
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify<JwtPayload>();
    } catch {
      await reply
        .code(401)
        .send({ error: 'Unauthorized', message: 'Invalid or expired access token.' });
      return;
    }
    const payload = request.user as JwtPayload;
    request.authUser = payload;
    request.userId = payload.sub;
  });
}

export default fp(authPlugin, { name: 'votion-auth' });
