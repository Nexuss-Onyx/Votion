/**
 * Authentication routes.
 *
 * - `POST /api/auth/register` — signup (Argon2id password hashing), creates a
 *   personal workspace, and returns an access + refresh token pair.
 * - `POST /api/auth/login` — verifies credentials and returns a token pair.
 * - `POST /api/auth/refresh` — rotates the refresh token (single-use).
 * - `POST /api/auth/logout` — revokes the refresh token.
 * - `GET  /api/auth/me` — returns the authenticated user's profile.
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { hashToken } from '../lib/redis.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from '../schemas.js';
import type { UserRecord } from '../store/types.js';

function publicUser(user: UserRecord): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Issues an access token + rotating refresh token pair for a user. */
async function issueTokens(
  fastify: FastifyInstance,
  user: UserRecord,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
  const accessToken = fastify.jwt.sign({ sub: user.id, email: user.email });
  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Date.now() + fastify.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await fastify.store.createRefreshToken(user.id, hashToken(refreshToken), expiresAt);
  return { accessToken, refreshToken, expiresIn: fastify.config.JWT_ACCESS_TTL };
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }
    const { email, password, fullName, workspaceName } = parsed.data;
    const existing = await fastify.store.findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'Conflict', message: 'Email already registered.' });
    }
    const passwordHash = await hashPassword(password);
    const user = await fastify.store.createUser({ email, passwordHash, fullName });
    const workspace = await fastify.store.createWorkspace({
      name: workspaceName ?? `${fullName}'s Workspace`,
    });
    await fastify.store.addMember(workspace.id, user.id, 'owner');
    const tokens = await issueTokens(fastify, user);
    return reply.code(201).send({
      user: publicUser(user),
      workspace: { id: workspace.id, name: workspace.name },
      ...tokens,
    });
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }
    const user = await fastify.store.findUserByEmail(parsed.data.email);
    const ok = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
    if (!user || !ok) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid email or password.' });
    }
    await fastify.store.touchUserLastActive(user.id);
    const tokens = await issueTokens(fastify, user);
    return reply.send({ user: publicUser(user), ...tokens });
  });

  fastify.post('/api/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }
    const tokenHash = hashToken(parsed.data.refreshToken);
    const record = await fastify.store.findRefreshTokenByHash(tokenHash);
    if (!record || record.revokedAt !== null || record.expiresAt.getTime() < Date.now()) {
      return reply
        .code(401)
        .send({ error: 'Unauthorized', message: 'Invalid or expired refresh token.' });
    }
    // Rotation: the presented token is single-use.
    await fastify.store.revokeRefreshToken(tokenHash);
    const user = await fastify.store.findUserById(record.userId);
    if (!user) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'User no longer exists.' });
    }
    const tokens = await issueTokens(fastify, user);
    return reply.send({ user: publicUser(user), ...tokens });
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const parsed = logoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }
    await fastify.store.revokeRefreshToken(hashToken(parsed.data.refreshToken));
    return reply.send({ ok: true });
  });

  fastify.get(
    '/api/auth/me',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await fastify.store.findUserById(request.userId);
      if (!user) {
        return reply.code(404).send({ error: 'Not Found', message: 'User not found.' });
      }
      return reply.send({ user: publicUser(user) });
    },
  );
}
