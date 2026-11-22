/** Workspace / teamspace endpoints with membership-based access control. */

import type { FastifyInstance } from 'fastify';

import { addMemberSchema, createWorkspaceSchema, updateWorkspaceSchema } from '../schemas.js';

function serializeWorkspace(workspace: {
  id: string;
  name: string;
  domain: string | null;
  icon: string | null;
  plan: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return { ...workspace, createdAt: workspace.createdAt.toISOString(), updatedAt: workspace.updatedAt.toISOString() };
}

export async function workspaceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/workspaces', { preHandler: fastify.authenticate }, async (request, reply) => {
    const workspaces = await fastify.store.listWorkspacesForUser(request.userId);
    return reply.send({ workspaces: workspaces.map(serializeWorkspace) });
  });

  fastify.post('/api/workspaces', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = createWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    if (parsed.data.parentWorkspaceId && !(await fastify.store.findMember(parsed.data.parentWorkspaceId, request.userId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const workspace = await fastify.store.createWorkspace({
      name: parsed.data.name,
      domain: parsed.data.domain,
      icon: parsed.data.icon,
      settings: {
        ...(parsed.data.isTeamspace ? { isTeamspace: true } : {}),
        ...(parsed.data.parentWorkspaceId ? { parentWorkspaceId: parsed.data.parentWorkspaceId } : {}),
      },
    });
    const member = await fastify.store.addMember(workspace.id, request.userId, 'owner');
    return reply.code(201).send({ workspace: serializeWorkspace(workspace), role: member.role });
  });

  fastify.get('/api/workspaces/:workspaceId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const member = await fastify.store.findMember(workspaceId, request.userId);
    if (!member) return reply.code(404).send({ error: 'Not Found' });
    const workspace = await fastify.store.findWorkspaceById(workspaceId);
    if (!workspace) return reply.code(404).send({ error: 'Not Found' });
    const members = await fastify.store.listMembers(workspaceId);
    return reply.send({ workspace: serializeWorkspace(workspace), role: member.role, members });
  });

  fastify.patch('/api/workspaces/:workspaceId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const member = await fastify.store.findMember(workspaceId, request.userId);
    if (!member || !['owner', 'admin'].includes(member.role)) return reply.code(403).send({ error: 'Forbidden' });
    const parsed = updateWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    const workspace = await fastify.store.updateWorkspace(workspaceId, parsed.data);
    if (!workspace) return reply.code(404).send({ error: 'Not Found' });
    return reply.send({ workspace: serializeWorkspace(workspace) });
  });

  fastify.delete('/api/workspaces/:workspaceId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const member = await fastify.store.findMember(workspaceId, request.userId);
    if (!member || member.role !== 'owner') return reply.code(403).send({ error: 'Forbidden' });
    await fastify.store.deleteWorkspace(workspaceId);
    return reply.code(204).send();
  });

  fastify.post('/api/workspaces/:workspaceId/members', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const actor = await fastify.store.findMember(workspaceId, request.userId);
    if (!actor || !['owner', 'admin'].includes(actor.role)) return reply.code(403).send({ error: 'Forbidden' });
    const parsed = addMemberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    if (!(await fastify.store.findUserById(parsed.data.userId))) return reply.code(404).send({ error: 'User Not Found' });
    const member = await fastify.store.addMember(workspaceId, parsed.data.userId, parsed.data.role);
    return reply.code(201).send({ member });
  });

  fastify.delete('/api/workspaces/:workspaceId/members/:userId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
    const actor = await fastify.store.findMember(workspaceId, request.userId);
    if (!actor || !['owner', 'admin'].includes(actor.role)) return reply.code(403).send({ error: 'Forbidden' });
    if (userId === request.userId && actor.role === 'owner') return reply.code(400).send({ error: 'Owner cannot remove self.' });
    const removed = await fastify.store.removeMember(workspaceId, userId);
    return removed ? reply.code(204).send() : reply.code(404).send({ error: 'Member Not Found' });
  });
}
