/**
 * Meilisearch connection manager & index provisioning.
 *
 * Responsibilities:
 *  - resolve `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY` from the environment;
 *  - create (idempotently) the `votion_blocks` index with its primary key;
 *  - apply the canonical settings from `indexSchema.ts` (only the diff);
 *  - expose a configured {@link SearchExecutor} for the query layer;
 *  - mint search-scoped tenant tokens so the browser never holds the API key.
 *
 * The SDK is imported for exactly two things — the client constructor and the
 * tenant-token signer. Both are injectable ({@link MeiliClientLike}) so the
 * provisioning logic is unit-testable without a live cluster.
 */

import { Meilisearch } from 'meilisearch';
import { generateTenantToken } from 'meilisearch/token';

import {
  BLOCKS_INDEX_PRIMARY_KEY,
  BLOCKS_INDEX_UID,
  blocksIndexUid,
  diffIndexSettings,
  type BlocksIndexSettings,
} from './indexSchema.js';
import {
  SearchTransportError,
  toSearchTransportError,
  type EnqueuedTaskLike,
  type MeiliClientLike,
  type MeiliIndexLike,
  type RawSearchResponse,
  type SearchExecutor,
  type SearchRequestInit,
} from './SearchTransport.js';
import type { MeiliSearchOptions } from '../query/QuickFindQueryBuilder.js';

/** Environment variable names required by the client. */
export const MEILISEARCH_ENV = {
  host: 'MEILISEARCH_HOST',
  apiKey: 'MEILISEARCH_API_KEY',
  searchKey: 'MEILISEARCH_SEARCH_KEY',
} as const;

/** Default per-request timeout (Quick Find must stay interactive). */
const DEFAULT_TIMEOUT_MS = 2_000;

/** Options accepted by {@link createMeiliSearchClient}. */
export interface MeiliSearchClientOptions {
  /** Base URL of the Meilisearch Cloud project. */
  host?: string;
  /** Server-side API key (admin/search key). Never shipped to the browser. */
  apiKey?: string;
  /** Index UID override (tenant sharding). */
  indexUid?: string;
  /** Extra `X-Meilisearch-Client` tags for fleet observability. */
  clientAgents?: string[];
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  /** Values injected in place of `process.env` (tests, edge runtimes). */
  env?: Record<string, string | undefined>;
  /** Pre-built SDK instance (dependency injection for tests). */
  client?: MeiliClientLike;
  /** Override of the tenant-token signer (tests). */
  tokenSigner?: typeof generateTenantToken;
}

/** Raised when the environment does not describe a usable Meilisearch host. */
export class MeiliSearchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeiliSearchConfigurationError';
  }
}

/** Reads the deployment environment without assuming `process` exists. */
function readEnv(): Record<string, string | undefined> {
  const globalProcess = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return globalProcess?.env ?? {};
}

/** Resolved connection settings. */
export interface ResolvedMeiliSearchConfig {
  host: string;
  apiKey: string | undefined;
  indexUid: string;
  timeout: number;
}

/**
 * Resolves host/API key from explicit options or the environment.
 *
 * Throws {@link MeiliSearchConfigurationError} when the host is missing or
 * malformed: a client without a host would silently fail every query, which is
 * far harder to debug at the call site.
 */
export function resolveMeiliSearchConfig(
  options: MeiliSearchClientOptions = {},
): ResolvedMeiliSearchConfig {
  const env = options.env ?? readEnv();
  const host = (options.host ?? env[MEILISEARCH_ENV.host] ?? '').trim();
  const apiKey =
    (options.apiKey ?? env[MEILISEARCH_ENV.apiKey] ?? '').trim() || undefined;

  if (host.length === 0) {
    throw new MeiliSearchConfigurationError(
      `${MEILISEARCH_ENV.host} is not set: @votion/search cannot reach Meilisearch`,
    );
  }
  if (!/^https?:\/\//i.test(host)) {
    throw new MeiliSearchConfigurationError(
      `${MEILISEARCH_ENV.host} must be an absolute http(s) URL (received "${host}")`,
    );
  }

  return {
    host: host.replace(/\/+$/, ''),
    apiKey,
    indexUid: options.indexUid ?? BLOCKS_INDEX_UID,
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  };
}

/** Outcome of {@link MeiliSearchClient.ensureIndex}. */
export interface EnsureIndexResult {
  indexUid: string;
  created: boolean;
  /** Settings keys that were pushed (empty when the index was canonical). */
  settingsUpdated: string[];
}

function isMissingIndexError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return message.includes('not found') || message.includes('index_not_found');
}

function isExistingIndexError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('index_already_exists')
  );
}

/**
 * Thin, testable wrapper around the `meilisearch` SDK.
 *
 * ```ts
 * const client = createMeiliSearchClient();   // reads MEILISEARCH_*
 * await client.ensureIndex();                 // idempotent provisioning
 * const res = await client.execute('q4 roa', options);
 * ```
 */
export class MeiliSearchClient implements SearchExecutor {
  readonly indexUid: string;
  private readonly sdk: MeiliClientLike;
  private readonly signer: typeof generateTenantToken;

  constructor(options: MeiliSearchClientOptions = {}) {
    const resolved = resolveMeiliSearchConfig(options);
    this.indexUid = resolved.indexUid;
    this.signer = options.tokenSigner ?? generateTenantToken;
    this.sdk =
      options.client ??
      (new Meilisearch({
        host: resolved.host,
        timeout: resolved.timeout,
        clientAgents: ['votion-search/0.1.0', ...(options.clientAgents ?? [])],
        ...(resolved.apiKey !== undefined ? { apiKey: resolved.apiKey } : {}),
      }) as unknown as MeiliClientLike);
  }

  /** Liveness probe. */
  async health(): Promise<boolean> {
    try {
      return await this.sdk.isHealthy();
    } catch (error) {
      throw toSearchTransportError(error);
    }
  }

  /** Server version (`pkgVersion`), surfaced by the provision script. */
  async version(): Promise<string> {
    try {
      const version = await this.sdk.getVersion();
      return version.pkgVersion;
    } catch (error) {
      throw toSearchTransportError(error);
    }
  }

  /**
   * Creates the index if needed and applies any settings that drift from
   * {@link BLOCKS_INDEX_SETTINGS}. Safe to call on every deploy.
   */
  async ensureIndex(
    options: { wait?: boolean } = {},
  ): Promise<EnsureIndexResult> {
    const shouldWait = options.wait !== false;
    let created = false;

    try {
      const task = await this.sdk.createIndex(this.indexUid, {
        primaryKey: BLOCKS_INDEX_PRIMARY_KEY,
      });
      if (shouldWait) {
        await task.waitTask();
      }
      created = true;
    } catch (error) {
      if (!isExistingIndexError(error)) {
        throw toSearchTransportError(error);
      }
    }

    const index = await this.safeGetIndex();
    if (!index) {
      throw new SearchTransportError(
        `Index "${this.indexUid}" is unavailable after creation`,
      );
    }

    const live = await this.readSettings(index);
    const diff = diffIndexSettings(live);
    const settingsUpdated = Object.keys(diff);
    if (settingsUpdated.length > 0) {
      const task = await index.updateSettings(diff as Record<string, unknown>);
      if (shouldWait) {
        await task.waitTask();
      }
    }

    return { indexUid: this.indexUid, created, settingsUpdated };
  }

  /** Returns the index handle, or `null` when it does not exist yet. */
  async safeGetIndex(
    uid: string = this.indexUid,
  ): Promise<MeiliIndexLike | null> {
    try {
      return await this.sdk.getIndex(uid);
    } catch (error) {
      if (isMissingIndexError(error)) {
        return null;
      }
      throw toSearchTransportError(error);
    }
  }

  /** Returns the index handle, provisioning it when missing. */
  async getIndex(uid: string = this.indexUid): Promise<MeiliIndexLike> {
    const existing = await this.safeGetIndex(uid);
    if (existing) {
      return existing;
    }
    await this.ensureIndex();
    const provisioned = await this.safeGetIndex(uid);
    if (!provisioned) {
      throw new SearchTransportError(`Index "${uid}" could not be provisioned`);
    }
    return provisioned;
  }

  /** Reads the live settings (a subset is enough for the diff check). */
  private async readSettings(
    index: MeiliIndexLike,
  ): Promise<Partial<BlocksIndexSettings>> {
    try {
      const settings = await index.getSettings();
      return settings as unknown as Partial<BlocksIndexSettings>;
    } catch {
      // Unreadable settings simply mean "apply everything".
      return {};
    }
  }

  /**
   * Executes a Quick Find query against the bound index.
   *
   * Options come from {@link toMeiliSearchOptions}; nothing from the request
   * body reaches Meilisearch without going through the projection.
   */
  async execute(
    query: string,
    options: MeiliSearchOptions,
    requestInit?: SearchRequestInit,
  ): Promise<RawSearchResponse> {
    return this.executeOn(this.indexUid, query, options, requestInit);
  }

  /** Executes against an explicit index (tenant sharding). */
  async executeOn(
    indexUid: string,
    query: string,
    options: MeiliSearchOptions,
    requestInit?: SearchRequestInit,
  ): Promise<RawSearchResponse> {
    const params = options as unknown as Record<string, unknown>;
    try {
      const index = await this.getIndex(indexUid);
      return await index.search(
        query,
        params,
        requestInit?.signal ? { signal: requestInit.signal } : undefined,
      );
    } catch (error) {
      throw toSearchTransportError(error);
    }
  }

  /** Adds or replaces documents (the search worker calls this in batches). */
  async upsertDocuments(
    documents: readonly Record<string, unknown>[],
  ): Promise<number | null> {
    if (documents.length === 0) {
      return null;
    }
    try {
      const index = await this.getIndex();
      const task = await index.addDocuments([...documents]);
      const result = await task.waitTask();
      return result.uid;
    } catch (error) {
      throw toSearchTransportError(error);
    }
  }

  /** Removes documents by id (soft deletes, purges, permission revocations). */
  async deleteDocuments(ids: readonly string[]): Promise<number | null> {
    if (ids.length === 0) {
      return null;
    }
    try {
      const index = await this.getIndex();
      const task = await index.deleteDocuments([...ids]);
      const result = await task.waitTask();
      return result.uid;
    } catch (error) {
      throw toSearchTransportError(error);
    }
  }

  /**
   * Mints a search-only tenant token for the browser.
   *
   * The token embeds the user's ACL as `searchRules`, so even a compromised
   * client cannot read another workspace: Meilisearch enforces the embedded
   * filter on every request. The signing key never leaves the server.
   */
  async createScopedSearchToken(options: {
    /** UID of the API key that signs the token. */
    apiKeyUid: string;
    /** Filter expression granted to the token holder. */
    scopeFilter: string;
    expiresAt?: Date | number;
    indexUid?: string;
    /** Signing key; defaults to the client's configured API key. */
    apiKey?: string;
    /** Skip the SDK's browser-environment guard (never enable in production). */
    force?: boolean;
  }): Promise<string> {
    const indexUid = options.indexUid ?? this.indexUid;
    const apiKey = options.apiKey ?? this.sdk.config?.apiKey;
    if (!apiKey) {
      throw new MeiliSearchConfigurationError(
        `A signing key is required to mint tenant tokens (set ${MEILISEARCH_ENV.apiKey})`,
      );
    }
    try {
      return await this.signer({
        apiKey,
        apiKeyUid: options.apiKeyUid,
        searchRules: { [indexUid]: { filter: options.scopeFilter } },
        ...(options.expiresAt !== undefined
          ? { expiresAt: options.expiresAt }
          : {}),
        ...(options.force !== undefined ? { force: options.force } : {}),
      });
    } catch (error) {
      throw toSearchTransportError(error);
    }
  }
}

/** Factory mirroring `createDatabaseFromEnv` in `@votion/db`. */
export function createMeiliSearchClient(
  options: MeiliSearchClientOptions = {},
): MeiliSearchClient {
  return new MeiliSearchClient(options);
}

/**
 * Builds an executor for a tenant-sharded index, so one client can serve the
 * worker fleet without re-resolving credentials per tenant.
 */
export function createTenantExecutor(
  client: MeiliSearchClient,
  tenantPrefix: string,
): SearchExecutor {
  const indexUid = blocksIndexUid(tenantPrefix);
  return {
    indexUid,
    execute: (query, options, requestInit) =>
      client.executeOn(indexUid, query, options, requestInit),
  };
}

export type { EnqueuedTaskLike, MeiliClientLike, MeiliIndexLike };
