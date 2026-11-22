/**
 * Storage abstraction for the transaction server.
 *
 * Routes depend only on this interface. Production wires the PostgreSQL
 * (Drizzle) implementation; tests and local development without a database
 * use the in-memory implementation. Both implement identical semantics —
 * notably atomic multi-operation batches with full rollback on failure.
 */

import type {
  BlockFormat,
  BlockProperties,
  BlockType,
  CollectionSchema,
  CollectionViewFormat,
  CollectionViewQuery,
  Operation,
  ParentTable,
  RichText,
  Transaction,
  UUID,
  ViewType,
  WorkspaceRole,
} from '@votion/types';

import type { AutomationAction, AutomationTrigger } from '../api/v1/automations/types.js';

/** Persisted block row (mirrors the `blocks` table). */
export interface BlockRecord {
  id: UUID;
  spaceId: UUID;
  version: number;
  type: BlockType;
  properties: BlockProperties;
  format: BlockFormat;
  content: UUID[];
  parentId: UUID;
  parentTable: ParentTable;
  alive: boolean;
  createdTime: Date;
  lastEditedTime: Date;
  createdById: UUID | null;
  lastEditedById: UUID | null;
}

/** Persisted collection row (mirrors the `collections` table). */
export interface CollectionRecord {
  id: UUID;
  spaceId: UUID;
  parentId: UUID;
  name: RichText;
  description: RichText;
  schema: CollectionSchema;
  icon: string | null;
  cover: string | null;
  alive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Persisted collection view row (mirrors the `collection_views` table). */
export interface CollectionViewRecord {
  id: UUID;
  spaceId: UUID;
  collectionId: UUID;
  type: ViewType;
  name: string;
  format: CollectionViewFormat;
  query2: CollectionViewQuery;
  alive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Persisted user row (mirrors the `users` table). */
export interface UserRecord {
  id: UUID;
  email: string;
  passwordHash: string | null;
  fullName: string;
  avatarUrl: string | null;
  locale: string;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Persisted workspace row (mirrors the `workspaces` table). */
export interface WorkspaceRecord {
  id: UUID;
  name: string;
  domain: string | null;
  icon: string | null;
  plan: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Persisted membership row (mirrors `workspace_members`). */
export interface WorkspaceMemberRecord {
  workspaceId: UUID;
  userId: UUID;
  role: WorkspaceRole;
  createdAt: Date;
}

/** Persisted refresh-token row (hashed token, rotation support). */
export interface RefreshTokenRecord {
  id: UUID;
  userId: UUID;
  /** SHA-256 hex digest of the opaque refresh token. */
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Write-ahead log row (mirrors `transaction_records`). */
export interface TransactionRecordRow {
  /** Monotonic WAL sequence number. */
  id: number;
  transactionId: UUID;
  requestId: UUID | null;
  spaceId: UUID;
  userId: UUID;
  operations: Operation[];
  versions: Record<UUID, number>;
  createdAt: Date;
}

/** Persisted integration token row (mirrors the `api_keys` table). */
export interface ApiKeyRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  /** SHA-256 hex digest of the plaintext `secret_...` token. */
  tokenHash: string;
  tokenPrefix: string;
  capabilities: string[];
  createdById: UUID | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Input for creating an integration token. */
export interface NewApiKey {
  id?: UUID;
  workspaceId: UUID;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  capabilities?: string[];
  createdById?: UUID | null;
  expiresAt?: Date | null;
}

/** Persisted webhook subscription row (mirrors `webhook_subscriptions`). */
export interface WebhookSubscriptionRecord {
  id: UUID;
  workspaceId: UUID;
  url: string;
  secret: string;
  events: string[];
  alive: boolean;
  createdById: UUID | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a webhook subscription. */
export interface NewWebhookSubscription {
  id?: UUID;
  workspaceId: UUID;
  url: string;
  secret: string;
  events?: string[];
  createdById?: UUID | null;
}

/** Persisted webhook delivery attempt row (mirrors `webhook_deliveries`). */
export interface WebhookDeliveryRecord {
  id: UUID;
  subscriptionId: UUID;
  event: string;
  payload: unknown;
  signature: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: Date;
}

/** Input for recording a webhook delivery. */
export interface NewWebhookDelivery {
  id?: UUID;
  subscriptionId: UUID;
  event: string;
  payload: unknown;
  signature: string;
  attempts: number;
  responseStatus?: number | null;
  error?: string | null;
}

/** Persisted automation rule row (mirrors `automation_rules`). */
export interface AutomationRuleRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  description: string | null;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  alive: boolean;
  createdById: UUID | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating an automation rule. */
export interface NewAutomationRule {
  id?: UUID;
  workspaceId: UUID;
  name: string;
  description?: string | null;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  createdById?: UUID | null;
}

/** Partial block mutation accepted by {@link DataStore.updateBlock}. */
export interface BlockPatch {
  properties?: BlockProperties;
  format?: BlockFormat;
  content?: UUID[];
  alive?: boolean;
}

/** Outcome of applying one transaction inside a batch. */
export interface AppliedTransaction {
  transactionId: UUID;
  /** New record versions keyed by record id. */
  versions: Record<UUID, number>;
}

/** Input for creating a user. */
export interface NewUser {
  email: string;
  passwordHash: string;
  fullName: string;
}

/** Input for creating a workspace. */
export interface NewWorkspace {
  name: string;
  domain?: string | null;
  icon?: string | null;
  settings?: Record<string, unknown>;
}

/** Input for creating a block. */
export interface NewBlock {
  id?: UUID;
  spaceId: UUID;
  type: BlockType;
  properties?: BlockProperties;
  format?: BlockFormat;
  content?: UUID[];
  parentId: UUID;
  parentTable: ParentTable;
  createdById?: UUID | null;
}

/** Input for creating a collection. */
export interface NewCollection {
  id?: UUID;
  spaceId: UUID;
  parentId: UUID;
  name?: RichText;
  description?: RichText;
  schema?: CollectionSchema;
}

/** Input for creating a collection view. */
export interface NewCollectionView {
  id?: UUID;
  spaceId: UUID;
  collectionId: UUID;
  type: ViewType;
  name: string;
  format?: CollectionViewFormat;
  query2?: CollectionViewQuery;
}

/**
 * The storage contract used by every route.
 *
 * `applyTransactions` is the heart of the server: it must apply the whole
 * batch atomically (all-or-nothing), bump versions, append WAL rows, and
 * throw on any failure so the route can respond without partial writes.
 */
export interface DataStore {
  // ---- users -------------------------------------------------------------
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: UUID): Promise<UserRecord | null>;
  createUser(input: NewUser): Promise<UserRecord>;
  touchUserLastActive(userId: UUID): Promise<void>;

  // ---- refresh tokens ----------------------------------------------------
  createRefreshToken(
    userId: UUID,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<RefreshTokenRecord>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeRefreshToken(tokenHash: string): Promise<boolean>;
  revokeAllRefreshTokens(userId: UUID): Promise<void>;

  // ---- workspaces & membership -------------------------------------------
  createWorkspace(input: NewWorkspace): Promise<WorkspaceRecord>;
  findWorkspaceById(id: UUID): Promise<WorkspaceRecord | null>;
  findWorkspaceByDomain(domain: string): Promise<WorkspaceRecord | null>;
  listWorkspacesForUser(userId: UUID): Promise<WorkspaceRecord[]>;
  updateWorkspace(
    id: UUID,
    patch: Partial<Pick<WorkspaceRecord, 'name' | 'domain' | 'icon' | 'settings'>>,
  ): Promise<WorkspaceRecord | null>;
  deleteWorkspace(id: UUID): Promise<boolean>;
  addMember(workspaceId: UUID, userId: UUID, role: WorkspaceRole): Promise<WorkspaceMemberRecord>;
  removeMember(workspaceId: UUID, userId: UUID): Promise<boolean>;
  findMember(workspaceId: UUID, userId: UUID): Promise<WorkspaceMemberRecord | null>;
  listMembers(workspaceId: UUID): Promise<WorkspaceMemberRecord[]>;

  // ---- blocks -------------------------------------------------------------
  findBlockById(id: UUID): Promise<BlockRecord | null>;
  listBlocksByIds(ids: UUID[]): Promise<BlockRecord[]>;
  createBlock(input: NewBlock): Promise<BlockRecord>;
  /** All alive rows of a collection (`parent_table = 'collection'`). */
  listCollectionRows(collectionId: UUID): Promise<BlockRecord[]>;
  /** Every alive block in a space (Developer API search / traversal). */
  listBlocksBySpace(spaceId: UUID): Promise<BlockRecord[]>;
  /**
   * Direct, atomic single-row mutation used by the Developer API and the
   * automation engine. JSONB payloads are merged; `alive` supports soft
   * deletes. Bumps `version` and stamps `last_edited_*`.
   */
  updateBlock(
    id: UUID,
    patch: BlockPatch,
    editedById?: UUID | null,
  ): Promise<BlockRecord | null>;

  // ---- integration tokens (Developer API) ---------------------------------
  createApiKey(input: NewApiKey): Promise<ApiKeyRecord>;
  findApiKeyByTokenHash(tokenHash: string): Promise<ApiKeyRecord | null>;
  listApiKeys(workspaceId: UUID): Promise<ApiKeyRecord[]>;
  revokeApiKey(id: UUID, workspaceId: UUID): Promise<boolean>;
  touchApiKeyLastUsed(id: UUID): Promise<void>;

  // ---- collections & views ------------------------------------------------
  findCollectionById(id: UUID): Promise<CollectionRecord | null>;
  listCollectionsByIds(ids: UUID[]): Promise<CollectionRecord[]>;
  findCollectionViewById(id: UUID): Promise<CollectionViewRecord | null>;
  listCollectionViewsByIds(ids: UUID[]): Promise<CollectionViewRecord[]>;
  listViewsForCollection(collectionId: UUID): Promise<CollectionViewRecord[]>;
  createCollection(input: NewCollection): Promise<CollectionRecord>;
  createCollectionView(input: NewCollectionView): Promise<CollectionViewRecord>;
  /** Every alive collection in a space (Developer API search). */
  listCollectionsBySpace(spaceId: UUID): Promise<CollectionRecord[]>;
  /** Updates collection metadata (`name`, `description`, `schema`, `alive`). */
  updateCollection(
    id: UUID,
    patch: Partial<Pick<CollectionRecord, 'name' | 'description' | 'schema' | 'alive'>>,
  ): Promise<CollectionRecord | null>;

  // ---- webhook subscriptions (Developer API) ------------------------------
  createWebhookSubscription(
    input: NewWebhookSubscription,
  ): Promise<WebhookSubscriptionRecord>;
  findWebhookSubscriptionById(id: UUID): Promise<WebhookSubscriptionRecord | null>;
  listWebhookSubscriptions(workspaceId: UUID): Promise<WebhookSubscriptionRecord[]>;
  /** Alive subscriptions for a space, optionally filtered by event name. */
  listActiveWebhookSubscriptions(
    workspaceId: UUID,
    events?: string[],
  ): Promise<WebhookSubscriptionRecord[]>;
  deleteWebhookSubscription(id: UUID, workspaceId: UUID): Promise<boolean>;
  createWebhookDelivery(input: NewWebhookDelivery): Promise<WebhookDeliveryRecord>;
  listWebhookDeliveries(subscriptionId: UUID): Promise<WebhookDeliveryRecord[]>;

  // ---- automation rules (Developer API) -----------------------------------
  createAutomationRule(input: NewAutomationRule): Promise<AutomationRuleRecord>;
  findAutomationRuleById(id: UUID): Promise<AutomationRuleRecord | null>;
  listAutomationRules(workspaceId: UUID): Promise<AutomationRuleRecord[]>;
  /** Alive rules for a space, optionally filtered by trigger type. */
  listActiveAutomationRules(
    workspaceId: UUID,
    triggerType?: string,
  ): Promise<AutomationRuleRecord[]>;
  deleteAutomationRule(id: UUID, workspaceId: UUID): Promise<boolean>;

  // ---- transactions (atomic) ----------------------------------------------
  /**
   * Applies every transaction in `batch` atomically. Either all operations
   * land (with version bumps + WAL rows) or none do.
   */
  applyTransactions(
    batch: Transaction[],
    requestId: UUID,
    userId: UUID,
  ): Promise<AppliedTransaction[]>;

  /** WAL rows for a space, oldest first (audit / replay support). */
  listTransactionRecords(spaceId: UUID): Promise<TransactionRecordRow[]>;

  /** Releases pooled resources (no-op for the in-memory store). */
  close(): Promise<void>;
}
