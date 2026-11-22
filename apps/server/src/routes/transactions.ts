/** Atomic transaction pipeline: POST /api/v3/saveTransactions. */

import type { FastifyInstance } from 'fastify';
import type { Transaction } from '@votion/types';

import { OperationError } from '../lib/jsonpatch.js';
import { spaceEventsChannel, type SpaceEventMessage } from '../lib/redis.js';
import { saveTransactionsSchema } from '../schemas.js';

export async function transactionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/v3/saveTransactions',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = saveTransactionsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
      }
      const { requestId } = parsed.data;
      const transactions = parsed.data.transactions as Transaction[];

      // Membership checks happen before entering storage, and every operation
      // must agree with its enclosing transaction's space.
      const spaces = new Set<string>();
      for (const transaction of transactions) {
        spaces.add(transaction.spaceId);
        for (const operation of transaction.operations) {
          if (operation.pointer.spaceId !== transaction.spaceId) {
            return reply.code(400).send({
              error: 'Bad Request',
              message: 'Operation spaceId must match transaction spaceId.',
            });
          }
        }
      }
      for (const spaceId of spaces) {
        if (!(await fastify.store.findMember(spaceId, request.userId))) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: `User is not a member of space ${spaceId}.`,
          });
        }
      }

      try {
        const applied = await fastify.store.applyTransactions(
          transactions,
          requestId,
          request.userId,
        );
        const versions: Record<string, number> = {};
        for (const result of applied) Object.assign(versions, result.versions);
        // Publish only after the storage transaction commits. The durable WAL
        // remains authoritative if Redis is unavailable.
        for (const spaceId of spaces) {
          const message: SpaceEventMessage = {
            type: 'record_updated',
            spaceId,
            requestId,
            userId: request.userId,
            versions,
            publishedAt: new Date().toISOString(),
          };
          await fastify.publisher.publish(
            spaceEventsChannel(spaceId),
            JSON.stringify(message),
          );
        }
        return reply.send({ requestId, results: applied.map((result) => ({
          id: result.transactionId,
          versions: result.versions,
          applied: true,
        })) });
      } catch (error) {
        if (error instanceof OperationError) {
          return reply.code(409).send({ error: 'Transaction Rejected', message: error.message });
        }
        fastify.log.error({ err: error }, 'saveTransactions failed');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
