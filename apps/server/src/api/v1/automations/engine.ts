/**
 * In-database automation engine (Phase 11).
 *
 * Evaluates `page_added` and `property_edited` triggers whenever the Developer
 * API mutates a record, then executes the rule's ordered actions:
 * `update_property`, `create_page`, and `dispatch_webhook`.
 *
 * The engine is deliberately persistence-agnostic: it consumes the same
 * {@link DataStore} contract as the HTTP routes, so the in-memory and
 * PostgreSQL backends behave identically.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import type { CollectionSchema, UUID } from '@votion/types';

import type {
  AutomationAction,
  AutomationActionOutcome,
  AutomationExecutionResult,
  CreatePageAction,
  DispatchWebhookAction,
  UpdatePropertyAction,
} from './types.js';
import type {
  AutomationRuleRecord,
  BlockRecord,
  CollectionRecord,
  DataStore,
} from '../../../store/types.js';
import {
  coerceAutomationValue,
  resolvePropertyId,
  resolvePropertiesToIds,
  storedValueToPlainText,
  toNotionPage,
  toVotionPropertyValue,
} from '../mappers.js';
import type { WebhookDispatcher } from '../webhooks/dispatcher.js';

/** Options for the automation engine. */
export interface AutomationEngineOptions {
  /** Dispatcher used by the `dispatch_webhook` action. */
  dispatcher?: WebhookDispatcher;
  /** Optional diagnostics sink. */
  logger?: { info?: (message: string, meta?: Record<string, unknown>) => void };
  /** Clock override (tests). */
  now?: () => Date;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Evaluates automation rules against Developer API mutations. */
export class AutomationEngine {
  private readonly store: DataStore;
  private readonly options: AutomationEngineOptions;

  constructor(store: DataStore, options: AutomationEngineOptions = {}) {
    this.store = store;
    this.options = options;
  }

  /** Evaluates `page_added` triggers after a row is created. */
  async handlePageAdded(
    block: BlockRecord,
    collection?: CollectionRecord | null,
  ): Promise<AutomationExecutionResult[]> {
    const rules = await this.store.listActiveAutomationRules(block.spaceId, 'page_added');
    const results: AutomationExecutionResult[] = [];
    for (const rule of rules) {
      if (!this.matchesPageAdded(rule.trigger, block, collection)) {
        continue;
      }
      results.push(await this.executeRule(rule, block, collection));
    }
    return results;
  }

  /** Evaluates `property_edited` triggers after a row is updated. */
  async handlePropertyChanged(
    block: BlockRecord,
    before: BlockRecord,
    collection?: CollectionRecord | null,
  ): Promise<AutomationExecutionResult[]> {
    const rules = await this.store.listActiveAutomationRules(block.spaceId, 'property_edited');
    const results: AutomationExecutionResult[] = [];
    for (const rule of rules) {
      if (!this.matchesPropertyEdited(rule.trigger, block, before, collection)) {
        continue;
      }
      results.push(await this.executeRule(rule, block, collection));
    }
    return results;
  }

  /** Whether a `page_added` trigger matches the created block. */
  private matchesPageAdded(
    trigger: AutomationRuleRecord['trigger'],
    block: BlockRecord,
    collection?: CollectionRecord | null,
  ): boolean {
    if (trigger.type !== 'page_added') {
      return false;
    }
    // `page_added` describes rows added to a database.
    if (block.parentTable !== 'collection') {
      return false;
    }
    if (trigger.database_id !== undefined && block.parentId !== trigger.database_id) {
      return false;
    }
    if (trigger.database_id !== undefined && collection && collection.id !== trigger.database_id) {
      return false;
    }
    return true;
  }

  /** Whether a `property_edited` trigger matches the mutation. */
  private matchesPropertyEdited(
    trigger: AutomationRuleRecord['trigger'],
    block: BlockRecord,
    before: BlockRecord,
    collection?: CollectionRecord | null,
  ): boolean {
    if (trigger.type !== 'property_edited') {
      return false;
    }
    if (trigger.database_id !== undefined && block.parentId !== trigger.database_id) {
      return false;
    }
    const propertyId = this.resolvePropertyId(collection, trigger.property);
    if (!propertyId) {
      return false;
    }
    const beforeValue = before.properties[propertyId];
    const afterValue = block.properties[propertyId];
    if (deepEqual(beforeValue, afterValue)) {
      return false;
    }
    if (trigger.value !== undefined) {
      return storedValueToPlainText(afterValue) === trigger.value;
    }
    return true;
  }

  private resolvePropertyId(
    collection: CollectionRecord | null | undefined,
    nameOrId: string,
  ): string | null {
    if (!collection) {
      return nameOrId;
    }
    return resolvePropertyId(collection.schema, nameOrId)?.propertyId ?? null;
  }

  /** Executes every action of a rule, collecting per-action outcomes. */
  private async executeRule(
    rule: AutomationRuleRecord,
    block: BlockRecord,
    collection?: CollectionRecord | null,
  ): Promise<AutomationExecutionResult> {
    const outcomes: AutomationActionOutcome[] = [];
    for (const action of rule.actions) {
      const outcome = await this.executeAction(rule, block, collection, action);
      outcomes.push(outcome);
    }
    const result: AutomationExecutionResult = {
      ruleId: rule.id,
      ruleName: rule.name,
      trigger: rule.trigger.type,
      actions: outcomes,
      ok: outcomes.every((outcome) => outcome.ok),
    };
    this.options.logger?.info?.('automation rule executed', {
      ruleId: rule.id,
      ok: result.ok,
    });
    return result;
  }

  private async executeAction(
    rule: AutomationRuleRecord,
    block: BlockRecord,
    collection: CollectionRecord | null | undefined,
    action: AutomationAction,
  ): Promise<AutomationActionOutcome> {
    try {
      switch (action.type) {
        case 'update_property':
          await this.applyUpdateProperty(rule, block, collection, action);
          break;
        case 'create_page':
          await this.applyCreatePage(rule, block, action);
          break;
        case 'dispatch_webhook':
          await this.applyDispatchWebhook(block, collection, action);
          break;
        default:
          return { type: 'update_property', ok: false, error: 'Unsupported action.' };
      }
      return { type: action.type, ok: true };
    } catch (error) {
      return {
        type: action.type,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async applyUpdateProperty(
    rule: AutomationRuleRecord,
    block: BlockRecord,
    collection: CollectionRecord | null | undefined,
    action: UpdatePropertyAction,
  ): Promise<void> {
    const propertyId = this.resolvePropertyId(collection, action.property);
    if (!propertyId) {
      throw new Error(`Unknown property "${action.property}".`);
    }
    const definition = collection?.schema[propertyId];
    const type = definition?.type ?? 'text';
    const value = coerceAutomationValue(action.value, type);
    const updated = await this.store.updateBlock(
      block.id,
      { properties: { [propertyId]: value } },
      rule.createdById,
    );
    if (!updated) {
      throw new Error(`Block ${block.id} no longer exists.`);
    }
  }

  private async applyCreatePage(
    rule: AutomationRuleRecord,
    block: BlockRecord,
    action: CreatePageAction,
  ): Promise<void> {
    const parent = action.parent;
    let parentId: UUID;
    let parentTable: 'block' | 'collection' | 'space';
    let spaceId = block.spaceId;
    let schema: CollectionSchema | null = null;

    if ('database_id' in parent) {
      const target = await this.store.findCollectionById(parent.database_id);
      if (!target) {
        throw new Error(`Database ${parent.database_id} not found.`);
      }
      parentId = target.id;
      parentTable = 'collection';
      spaceId = target.spaceId;
      schema = target.schema;
    } else if ('page_id' in parent) {
      const target = await this.store.findBlockById(parent.page_id);
      if (!target) {
        throw new Error(`Parent page ${parent.page_id} not found.`);
      }
      parentId = target.id;
      parentTable = 'block';
      spaceId = target.spaceId;
    } else {
      parentId = block.spaceId;
      parentTable = 'space';
    }

    const properties = schema
      ? resolvePropertiesToIds(schema, action.properties)
      : this.standalonePageProperties(action.properties);

    const created = await this.store.createBlock({
      spaceId,
      type: 'page',
      parentId,
      parentTable,
      properties,
      createdById: rule.createdById,
    });

    // Append the new page to its parent's ordered child list.
    if (parentTable === 'block' || parentTable === 'collection') {
      const parentBlock = await this.store.findBlockById(parentId);
      if (parentBlock && parentBlock.parentTable !== 'collection') {
        await this.store.updateBlock(parentId, {
          content: [...parentBlock.content, created.id],
        });
      }
    }
  }

  private standalonePageProperties(
    properties: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      if (key === 'title' || key === 'Name' || key === 'Title') {
        result['title'] = toVotionPropertyValue('title', value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private async applyDispatchWebhook(
    block: BlockRecord,
    collection: CollectionRecord | null | undefined,
    action: DispatchWebhookAction,
  ): Promise<void> {
    const dispatcher = this.options.dispatcher;
    if (!dispatcher) {
      throw new Error('No webhook dispatcher configured.');
    }
    const secret = action.secret ?? randomBytes(24).toString('hex');
    const payload = action.payload ?? { page: toNotionPage(block, collection) };
    await dispatcher.dispatchToUrl(
      action.url,
      secret,
      action.event ?? 'automation.triggered',
      payload,
    );
  }
}

/** Generates a random automation rule id (used by management routes). */
export function generateAutomationRuleId(): UUID {
  return randomUUID();
}
