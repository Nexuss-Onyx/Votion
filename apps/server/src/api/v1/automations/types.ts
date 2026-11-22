/**
 * In-database automation contracts (Phase 11).
 *
 * A rule couples one trigger to an ordered list of actions. Trigger/action
 * payloads are JSONB in `automation_rules`, validated here with Zod before
 * they are persisted or executed.
 */

import { z } from 'zod';

import type { UUID } from '@votion/types';

/** Trigger evaluated when a page is added to a database. */
export interface PageAddedTrigger {
  type: 'page_added';
  /** Optional database scope; omit to match every database in the space. */
  database_id?: UUID;
}

/** Trigger evaluated when a property of a database row changes. */
export interface PropertyEditedTrigger {
  type: 'property_edited';
  /** Property name (or id) watched for edits. */
  property: string;
  /** Optional value guard (e.g. `Done` for a `Status` property). */
  value?: string;
  /** Optional database scope. */
  database_id?: UUID;
}

/** Discriminated union of every supported automation trigger. */
export type AutomationTrigger = PageAddedTrigger | PropertyEditedTrigger;

/** Action that writes a property value onto the triggering record. */
export interface UpdatePropertyAction {
  type: 'update_property';
  /** Property name (or id) to write. */
  property: string;
  /** Notion-shaped or plain value to store. */
  value: unknown;
}

/** Action that appends a new page below a database or parent page. */
export interface CreatePageAction {
  type: 'create_page';
  parent:
    | { database_id: UUID }
    | { page_id: UUID }
    | { workspace: true };
  /** Property values keyed by property name (or id). */
  properties: Record<string, unknown>;
  /** Optional child blocks appended to the created page. */
  children?: unknown[];
}

/** Action that emits a signed webhook outside the subscription registry. */
export interface DispatchWebhookAction {
  type: 'dispatch_webhook';
  url: string;
  event?: string;
  payload?: Record<string, unknown>;
  /** Signing secret; generated when omitted. */
  secret?: string;
}

/** Discriminated union of every supported automation action. */
export type AutomationAction =
  | UpdatePropertyAction
  | CreatePageAction
  | DispatchWebhookAction;

/** Outcome of executing one action. */
export interface AutomationActionOutcome {
  type: AutomationAction['type'];
  ok: boolean;
  error?: string;
}

/** Outcome of evaluating a rule against one mutation. */
export interface AutomationExecutionResult {
  ruleId: UUID;
  ruleName: string;
  trigger: AutomationTrigger['type'];
  actions: AutomationActionOutcome[];
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Zod validators (shared by the management routes and the engine)
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();

export const pageAddedTriggerSchema = z.object({
  type: z.literal('page_added'),
  database_id: uuid.optional(),
});

export const propertyEditedTriggerSchema = z.object({
  type: z.literal('property_edited'),
  property: z.string().min(1).max(255),
  value: z.string().max(255).optional(),
  database_id: uuid.optional(),
});

export const automationTriggerSchema = z.discriminatedUnion('type', [
  pageAddedTriggerSchema,
  propertyEditedTriggerSchema,
]);

const parentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('database_id'), database_id: uuid }),
  z.object({ type: z.literal('page_id'), page_id: uuid }),
  z.object({ type: z.literal('workspace'), workspace: z.literal(true) }),
]);

// Also accept the bare `{ database_id }` / `{ page_id }` convenience shapes.
const createPageParentSchema = z.union([
  parentSchema,
  z.object({ database_id: uuid }),
  z.object({ page_id: uuid }),
  z.object({ workspace: z.literal(true) }),
]);

export const updatePropertyActionSchema = z.object({
  type: z.literal('update_property'),
  property: z.string().min(1).max(255),
  value: z.unknown(),
});

export const createPageActionSchema = z.object({
  type: z.literal('create_page'),
  parent: createPageParentSchema,
  properties: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.unknown()).max(200).optional(),
});

export const dispatchWebhookActionSchema = z.object({
  type: z.literal('dispatch_webhook'),
  url: z.string().url().max(2048),
  event: z.string().min(1).max(128).default('automation.triggered'),
  payload: z.record(z.string(), z.unknown()).optional(),
  secret: z.string().min(8).max(255).optional(),
});

export const automationActionSchema = z.discriminatedUnion('type', [
  updatePropertyActionSchema,
  createPageActionSchema,
  dispatchWebhookActionSchema,
]);

export const createAutomationRuleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  trigger: automationTriggerSchema,
  actions: z.array(automationActionSchema).min(1).max(50),
});

/** Normalises the accepted parent shapes into the canonical action parent. */
export function normalizeCreatePageParent(
  parent: z.infer<typeof createPageParentSchema>,
): CreatePageAction['parent'] {
  if ('type' in parent) {
    return parent;
  }
  if ('database_id' in parent) {
    return { database_id: parent.database_id };
  }
  if ('page_id' in parent) {
    return { page_id: parent.page_id };
  }
  return { workspace: true };
}
