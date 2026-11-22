/** Direct-to-bucket upload URL route. */

import type { FastifyInstance } from 'fastify';

import { UploadValidationError } from '../lib/s3.js';
import { getUploadFileUrlSchema } from '../schemas.js';

export async function assetRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/v3/getUploadFileUrl',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = getUploadFileUrlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
      }
      if (parsed.data.spaceId && !(await fastify.store.findMember(parsed.data.spaceId, request.userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      try {
        const result = await fastify.uploadSigner.getUploadUrl(parsed.data);
        return reply.send(result);
      } catch (error) {
        if (error instanceof UploadValidationError) {
          return reply.code(error.statusCode).send({ error: 'Invalid Upload', message: error.message });
        }
        fastify.log.error({ err: error }, 'presigned URL generation failed');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
