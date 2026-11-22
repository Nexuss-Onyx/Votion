/**
 * Developer API event fan-out.
 *
 * Every `/v1` mutation flows through this manager: it emits HMAC-signed
 * webhooks to subscribed endpoints and evaluates in-database automations.
 * Event delivery is best-effort — a failing webhook or automation must never
 * roll back or fail the originating API request.
 */

import type { UUID } from '@votion/types';

import type { BlockRecord, CollectionRecord } from '../../store/types.js';
import type { AutomationEngine } from './automations/engine.js';
import { toNotionBlock, toNotionDatabase, toNotionPage } from './mappers.js';
import type { WebhookDispatcher } from './webhooks/dispatcher.js';

/** Events emitted by the Developer API. */
export type V1EventType =
  | 'page.created'
  | 'page.updated'
  | 'page.deleted'
  | 'block.created'
  | 'block.updated'
  | 'database.created'
  | 'database.updated';

/** Coordinates webhook dispatch and automation execution for one mutation. */
export class V1EventManager {
  private readonly dispatcher: WebhookDispatcher;
  private readonly engine: AutomationEngine;

  constructor(dispatcher: WebhookDispatcher, engine: AutomationEngine) {
    this.dispatcher = dispatcher;
    this.engine = engine;
  }

  /** A database row/page was created. */
  async pageCreated(
    spaceId: UUID,
    block: BlockRecord,
    collection?: CollectionRecord | null,
  ): Promise<void> {
    await this.emit(spaceId, 'page.created', toNotionPage(block, collection));
    await this.run(() => this.engine.handlePageAdded(block, collection));
  }

  /** A database row/page was updated. */
  async pageUpdated(
    spaceId: UUID,
    block: BlockRecord,
    before: BlockRecord,
    collection?: CollectionRecord | null,
  ): Promise<void> {
    await this.emit(spaceId, 'page.updated', toNotionPage(block, collection));
    await this.run(() => this.engine.handlePropertyChanged(block, before, collection));
  }

  /** A page was archived/deleted. */
  async pageDeleted(
    spaceId: UUID,
    block: BlockRecord,
    collection?: CollectionRecord | null,
  ): Promise<void> {
    await this.emit(spaceId, 'page.deleted', toNotionPage(block, collection));
  }

  /** A non-page block was created. */
  async blockCreated(spaceId: UUID, block: BlockRecord): Promise<void> {
    await this.emit(spaceId, 'block.created', toNotionBlock(block));
  }

  /** A non-page block was updated or archived. */
  async blockUpdated(spaceId: UUID, block: BlockRecord): Promise<void> {
    await this.emit(spaceId, 'block.updated', toNotionBlock(block));
  }

  /** A database was created. */
  async databaseCreated(spaceId: UUID, collection: CollectionRecord): Promise<void> {
    await this.emit(spaceId, 'database.created', toNotionDatabase(collection));
  }

  /** A database was updated. */
  async databaseUpdated(spaceId: UUID, collection: CollectionRecord): Promise<void> {
    await this.emit(spaceId, 'database.updated', toNotionDatabase(collection));
  }

  private async emit(spaceId: UUID, event: V1EventType, data: unknown): Promise<void> {
    try {
      await this.dispatcher.dispatch(spaceId, event, data);
    } catch {
      /* Best-effort: the mutation is already committed. */
    }
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch {
      /* Best-effort: a broken rule must not break the API request. */
    }
  }
}
