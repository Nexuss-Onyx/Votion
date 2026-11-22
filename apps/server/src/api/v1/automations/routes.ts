/**
 * `/v1/automations` — management surface for in-database automation rules.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { capabilityGuard } from '../auth.js';
import {
  createAutomationRuleSchema,
  normalizeCreatePageParent,
  type AutomationAction,
} from './types.js';
import {
  parseBody,
  requireWorkspaceId,
  sendNotFound,
  sendUnauthorized,
} from '../helpers.js';
import type { AutomationRuleRecord } from '../../../store/types.js';

interface IdParams {
  id: string;
}

function toAutomationResponse(rule: AutomationRuleRecord): Record<string, unknown> {
  return {
    object: 'automation',
    id: rule.id,
    name: rule.name,
    description: rule.description,
    trigger: rule.trigger,
    actions: rule.actions,
    alive: rule.alive,
    created_by: { object: 'user', id: rule.createdById ?? '' },
    created_time: rule.createdAt.toISOString(),
    last_updated_time: rule.updatedAt.toISOString(),
  };
}

export async function automationRoutes(fastify: FastifyInstance): Promise<void> {
  const read = capabilityGuard('read');
  const manage = capabilityGuard('automations');

  fastify.post(
    '/automations',
    { preHandler: manage },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const parsed = parseBody(reply, createAutomationRuleSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const actions = parsed.data.actions.map((action) =>
        action.type === 'create_page'
          ? { ...action, parent: normalizeCreatePageParent(action.parent) }
          : action,
      ) as AutomationAction[];
      const rule = await fastify.store.createAutomationRule({
        workspaceId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        trigger: parsed.data.trigger,
        actions,
      });
      return reply.code(201).send(toAutomationResponse(rule));
    },
  );

  fastify.get(
    '/automations',
    { preHandler: read },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const rules = await fastify.store.listAutomationRules(workspaceId);
      return reply.send({
        object: 'list',
        results: rules.map(toAutomationResponse),
        next_cursor: null,
        has_more: false,
        type: 'automation',
        automation: {},
      });
    },
  );

  fastify.get<{ Params: IdParams }>(
    '/automations/:id',
    { preHandler: read },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const rule = await fastify.store.findAutomationRuleById(request.params.id);
      if (!rule || rule.workspaceId !== workspaceId) {
        return sendNotFound(reply, 'Automation not found.');
      }
      return reply.send(toAutomationResponse(rule));
    },
  );

  fastify.delete<{ Params: IdParams }>(
    '/automations/:id',
    { preHandler: manage },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const rule = await fastify.store.findAutomationRuleById(request.params.id);
      if (!rule || rule.workspaceId !== workspaceId) {
        return sendNotFound(reply, 'Automation not found.');
      }
      await fastify.store.deleteAutomationRule(rule.id, workspaceId);
      return reply.send(toAutomationResponse({ ...rule, alive: false }));
    },
  );
}
