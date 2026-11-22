/** Atomic transaction pipeline: POST /api/v3/saveTransactions. */

import type { FastifyInstance } from 'fastify';
import type { RecordUpdatedEnvelope, Transaction } from '@votion/types';

import { OperationError } from '../lib/jsonpatch.js';
import { spaceEventsChannel } from '../lib/redis.js';
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
        const versionByRecord = new Map<string, number>();
        for (const result of applied) {
          for (const [recordId, version] of Object.entries(result.versions)) {
            versionByRecord.set(recordId, version);
          }
        }

        // Phase 6 consumes one canonical RecordUpdatedEnvelope per record.
        // Build coarse patches from the committed row, not from request args,
        // so multiple ops to a field publish its final value.
        const changedPaths = new Map<string, Set<string>>();
        const recordSpaces = new Map<string, string>();
        for (const transaction of transactions) {
          for (const operation of transaction.operations) {
            const { table, id } = operation.pointer;
            const key = `${table}:${id}`;
            const fields = changedPaths.get(key) ?? new Set<string>();
            const rootField = operation.path[0];
            if (typeof rootField === 'string') fields.add(rootField);
            changedPaths.set(key, fields);
            recordSpaces.set(key, transaction.spaceId);
          }
        }
        for (const [key, fields] of changedPaths) {
          const [table, id] = key.split(':', 2);
          if (table !== 'block' || !id) continue;
          const block = await fastify.store.findBlockById(id);
          if (!block) continue;
          const patch: Record<string, unknown> = {};
          for (const field of fields) {
            if (field === 'properties') patch.properties = block.properties;
            else if (field === 'format') patch.format = block.format;
            else if (field === 'content') patch.content = block.content;
          }
          const message: RecordUpdatedEnvelope = {
            type: 'record_updated',
            table: 'block',
            id,
            version: versionByRecord.get(id) ?? block.version,
            patch,
            spaceId: recordSpaces.get(key),
            lastEditedTime: block.lastEditedTime.getTime(),
            lastEditedById: block.lastEditedById ?? undefined,
          };
          await fastify.publisher.publish(
            spaceEventsChannel(recordSpaces.get(key) ?? block.spaceId),
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
