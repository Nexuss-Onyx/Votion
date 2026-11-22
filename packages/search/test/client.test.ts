/**
 * Client-layer verification: configuration resolution, idempotent index
 * provisioning, hit hydration, ACL re-verification and the search service.
 */

import { describe, expect, it } from 'vitest';

import {
  BLOCKS_INDEX_PRIMARY_KEY,
  BLOCKS_INDEX_SETTINGS,
  BLOCKS_INDEX_UID,
  diffIndexSettings,
} from '../src/client/indexSchema.js';
import {
  MEILISEARCH_ENV,
  MeiliSearchClient,
  MeiliSearchConfigurationError,
  createMeiliSearchClient,
  createTenantExecutor,
  resolveMeiliSearchConfig,
} from '../src/client/MeiliSearchClient.js';
import type {
  MeiliClientLike,
  MeiliIndexLike,
  RawSearchResponse,
  SearchExecutor,
} from '../src/client/SearchTransport.js';
import { hydrateHit, hydrateHits } from '../src/client/hitHydration.js';
import {
  QuickFindSearchService,
  isAbortError,
  isDocumentReadable,
  isQuickFindHitInScope,
} from '../src/client/QuickFindSearchService.js';
import type { QuickFindAccessScope, SearchDocument } from '../src/types.js';
import {
  PROJECTS_PAGE_ID,
  ROADMAP_PAGE_ID,
  SPACE_ID,
  USER_ID,
} from './fixtures/blocks.js';

const OTHER_SPACE_ID = '88888888-8888-4888-8888-888888888888';
const SHARED_PAGE_ID = '77777777-7777-4777-8777-777777777777';

const scope: QuickFindAccessScope = {
  userId: USER_ID,
  spaceIds: [SPACE_ID],
  readableRootPageIds: [PROJECTS_PAGE_ID, ROADMAP_PAGE_ID],
};

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

describe('resolveMeiliSearchConfig', () => {
  it('reads the documented environment variables', () => {
    const resolved = resolveMeiliSearchConfig({
      env: {
        [MEILISEARCH_ENV.host]: 'https://ms-votion.meilisearch.io/',
        [MEILISEARCH_ENV.apiKey]: 'masterKey',
      },
    });
    expect(resolved.host).toBe('https://ms-votion.meilisearch.io');
    expect(resolved.apiKey).toBe('masterKey');
    expect(resolved.indexUid).toBe(BLOCKS_INDEX_UID);
    expect(resolved.timeout).toBe(2000);
  });

  it('prefers explicit options over the environment', () => {
    const resolved = resolveMeiliSearchConfig({
      host: 'http://localhost:7700',
      apiKey: 'dev',
      indexUid: 'tenant_blocks',
      timeout: 500,
      env: { [MEILISEARCH_ENV.host]: 'https://ignored' },
    });
    expect(resolved).toMatchObject({
      host: 'http://localhost:7700',
      apiKey: 'dev',
      indexUid: 'tenant_blocks',
      timeout: 500,
    });
  });

  it('fails loudly without a host', () => {
    expect(() => resolveMeiliSearchConfig({ env: {} })).toThrow(
      MeiliSearchConfigurationError,
    );
    expect(() =>
      resolveMeiliSearchConfig({ env: { [MEILISEARCH_ENV.host]: '   ' } }),
    ).toThrow(MeiliSearchConfigurationError);
  });

  it('rejects a host without a protocol', () => {
    expect(() =>
      resolveMeiliSearchConfig({
        env: { [MEILISEARCH_ENV.host]: 'ms-votion.meilisearch.io' },
      }),
    ).toThrow(/absolute http\(s\) URL/);
  });

  it('treats a blank API key as absent', () => {
    const resolved = resolveMeiliSearchConfig({
      env: {
        [MEILISEARCH_ENV.host]: 'https://ms.votion.dev',
        [MEILISEARCH_ENV.apiKey]: '  ',
      },
    });
    expect(resolved.apiKey).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Fake SDK                                                                   */
/* -------------------------------------------------------------------------- */

class FakeIndex implements MeiliIndexLike {
  settings: Record<string, unknown>;
  readonly searches: { query: string; params: Record<string, unknown> }[] = [];
  response: RawSearchResponse = {
    hits: [],
    processingTimeMs: 1,
    estimatedTotalHits: 0,
  };
  error: Error | null = null;

  constructor(settings: Record<string, unknown> = {}) {
    this.settings = settings;
  }

  async search(
    query: string,
    params: Record<string, unknown>,
  ): Promise<RawSearchResponse> {
    if (this.error) {
      throw this.error;
    }
    this.searches.push({ query, params });
    return this.response;
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return this.settings;
  }

  async updateSettings(settings: Record<string, unknown>) {
    this.settings = { ...this.settings, ...settings };
    return { uid: 1, waitTask: async () => ({ uid: 1, status: 'succeeded' }) };
  }

  async addDocuments(documents: Record<string, unknown>[]) {
    return { uid: 2, waitTask: async () => ({ uid: 2, status: 'succeeded' }) };
  }

  async deleteDocuments() {
    return { uid: 3, waitTask: async () => ({ uid: 3, status: 'succeeded' }) };
  }
}

class FakeSdk implements MeiliClientLike {
  readonly config: { host?: string; apiKey?: string } = {
    host: 'https://ms.test',
    apiKey: 'masterKey',
  };
  readonly indexes = new Map<string, FakeIndex>();
  createIndexCalls = 0;
  createIndexError: Error | null = null;
  /** When false, `createIndex` reports a conflict like a real second deploy. */
  allowCreate = true;

  async createIndex(uid: string, options?: { primaryKey?: string }) {
    this.createIndexCalls += 1;
    if (this.createIndexError) {
      throw this.createIndexError;
    }
    if (this.indexes.has(uid) || !this.allowCreate) {
      throw new Error(`Index \`${uid}\` already exists`);
    }
    this.indexes.set(uid, new FakeIndex());
    expect(options?.primaryKey).toBe(BLOCKS_INDEX_PRIMARY_KEY);
    return {
      uid: 10,
      waitTask: async () => ({ uid: 10, status: 'succeeded' }),
    };
  }

  async getIndex(uid: string) {
    const index = this.indexes.get(uid);
    if (!index) {
      throw new Error('Index `votion_blocks` not found');
    }
    return index;
  }

  async isHealthy() {
    return true;
  }

  async getVersion() {
    return { pkgVersion: '1.12.0' };
  }
}

function makeClient(sdk: FakeSdk): MeiliSearchClient {
  return createMeiliSearchClient({
    client: sdk,
    env: { [MEILISEARCH_ENV.host]: 'https://ms.test' },
  });
}

/* -------------------------------------------------------------------------- */
/* Provisioning                                                               */
/* -------------------------------------------------------------------------- */

describe('MeiliSearchClient.ensureIndex', () => {
  it('creates the index with the canonical primary key and settings', async () => {
    const sdk = new FakeSdk();
    const client = makeClient(sdk);
    const result = await client.ensureIndex();

    expect(result).toMatchObject({ indexUid: BLOCKS_INDEX_UID, created: true });
    expect(sdk.indexes.has(BLOCKS_INDEX_UID)).toBe(true);
    // A brand-new index receives the whole schema.
    expect(result.settingsUpdated.length).toBeGreaterThan(5);
    expect(sdk.indexes.get(BLOCKS_INDEX_UID)?.settings).toMatchObject({
      searchableAttributes: ['title', 'plain_text'],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
      ],
    });
  });

  it('is idempotent — a second run writes no settings', async () => {
    const sdk = new FakeSdk();
    const client = makeClient(sdk);
    await client.ensureIndex();
    const second = await client.ensureIndex();
    expect(second.created).toBe(false);
    expect(second.settingsUpdated).toEqual([]);
  });

  it('tolerates "index already exists" from a parallel deploy', async () => {
    const sdk = new FakeSdk();
    sdk.indexes.set(
      BLOCKS_INDEX_UID,
      new FakeIndex({ ...BLOCKS_INDEX_SETTINGS }),
    );
    sdk.allowCreate = false;
    const result = await makeClient(sdk).ensureIndex();
    expect(result.created).toBe(false);
    expect(result.settingsUpdated).toEqual([]);
  });

  it('rethrows unrelated creation failures', async () => {
    const sdk = new FakeSdk();
    sdk.createIndexError = new Error('invalid_api_key');
    await expect(makeClient(sdk).ensureIndex()).rejects.toThrow(
      'invalid_api_key',
    );
  });

  it('repairs drifted settings only', async () => {
    const sdk = new FakeSdk();
    sdk.indexes.set(
      BLOCKS_INDEX_UID,
      new FakeIndex({
        ...BLOCKS_INDEX_SETTINGS,
        rankingRules: ['words'],
        synonymKeys: 1,
      }),
    );
    const result = await makeClient(sdk).ensureIndex();
    expect(result.settingsUpdated).toEqual(['rankingRules']);
  });

  it('exposes health and version', async () => {
    const client = makeClient(new FakeSdk());
    await expect(client.health()).resolves.toBe(true);
    await expect(client.version()).resolves.toBe('1.12.0');
  });
});

describe('MeiliSearchClient queries', () => {
  it('forwards only the projected options', async () => {
    const sdk = new FakeSdk();
    const index = new FakeIndex();
    sdk.indexes.set(BLOCKS_INDEX_UID, index);
    const client = makeClient(sdk);

    await client.execute('q4', { filter: 'alive = true', limit: 5 });

    expect(index.searches[0]?.query).toBe('q4');
    expect(index.searches[0]?.params).toMatchObject({
      filter: 'alive = true',
      limit: 5,
    });
    expect(index.searches[0]?.params).not.toHaveProperty('q');
  });

  it('routes tenant queries to their own index', async () => {
    const sdk = new FakeSdk();
    const tenant = new FakeIndex();
    sdk.indexes.set('votion_blocks_eu', tenant);
    const client = makeClient(sdk);
    const executor = createTenantExecutor(client, 'eu');

    expect(executor.indexUid).toBe('votion_blocks_eu');
    await executor.execute('x', {});
    expect(tenant.searches).toHaveLength(1);
  });

  it('wraps SDK failures in a SearchTransportError', async () => {
    const sdk = new FakeSdk();
    const index = new FakeIndex();
    index.error = new Error('boom');
    sdk.indexes.set(BLOCKS_INDEX_UID, index);

    await expect(makeClient(sdk).execute('x', {})).rejects.toMatchObject({
      name: 'SearchTransportError',
      message: 'boom',
    });
  });

  it('skips empty upsert/delete batches', async () => {
    const client = makeClient(new FakeSdk());
    await expect(client.upsertDocuments([])).resolves.toBeNull();
    await expect(client.deleteDocuments([])).resolves.toBeNull();
  });

  it('mints a tenant token carrying the ACL filter', async () => {
    const sdk = new FakeSdk();
    const captured: unknown[] = [];
    const client = new MeiliSearchClient({
      client: sdk,
      env: { [MEILISEARCH_ENV.host]: 'https://ms.test' },
      tokenSigner: async (options) => {
        captured.push(options);
        return 'eyJhbGciOiJIUzI1NiJ9.token.signature';
      },
    });

    const token = await client.createScopedSearchToken({
      apiKeyUid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      scopeFilter: 'space_id = "abc" AND alive = true',
    });

    expect(token).toBe('eyJhbGciOiJIUzI1NiJ9.token.signature');
    expect(captured[0]).toMatchObject({
      apiKeyUid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      searchRules: {
        [BLOCKS_INDEX_UID]: { filter: 'space_id = "abc" AND alive = true' },
      },
    });
  });

  it('refuses to mint tokens without a signing key', async () => {
    const sdk = new FakeSdk();
    const client = new MeiliSearchClient({
      client: new (class extends FakeSdk {
        readonly config = {};
      })(),
      env: { [MEILISEARCH_ENV.host]: 'https://ms.test' },
    });
    await expect(
      client.createScopedSearchToken({
        apiKeyUid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        scopeFilter: 'alive = true',
      }),
    ).rejects.toThrow(MeiliSearchConfigurationError);
  });
});

/* -------------------------------------------------------------------------- */
/* Hydration                                                                  */
/* -------------------------------------------------------------------------- */

describe('hydrateHit', () => {
  const rawHit = {
    id: 'block-1',
    space_id: SPACE_ID,
    parent_id: PROJECTS_PAGE_ID,
    root_page_id: ROADMAP_PAGE_ID,
    type: 'heading_1' as const,
    title: 'Q4 Roadmap',
    plain_text: 'Q4 Roadmap doubling revenue',
    created_by: USER_ID,
    last_edited_time: 1_700_000_000_000,
    breadcrumb: 'Projects / Q4',
    _formatted: {
      title: '<mark>Q4</mark> Roadmap',
      plain_text: '<mark>Q4</mark> Roadmap doubling revenue',
    },
    _rankingScore: 0.94,
  };

  it('parses highlights into segments', () => {
    const hit = hydrateHit(rawHit);
    expect(hit?.title).toEqual([
      { text: 'Q4', highlighted: true },
      { text: ' Roadmap', highlighted: false },
    ]);
    expect(hit?.plainTitle).toBe('Q4 Roadmap');
    expect(hit?.rankingScore).toBe(0.94);
    expect(hit?.breadcrumb).toBe('Projects / Q4');
  });

  it('never emits raw HTML for a hostile title', () => {
    const hit = hydrateHit({
      id: 'x',
      title: '<img src=x onerror=alert(1)>',
      plain_text: '',
      _formatted: { title: '<img src=x onerror=alert(1)>' },
    });
    const rendered = (hit?.title ?? []).map((segment) => segment.text).join('');
    expect(rendered).toBe('<img src=x onerror=alert(1)>');
    // It is data, not markup: the parser must not treat it as a tag.
    expect(hit?.title.every((segment) => !segment.highlighted)).toBe(true);
  });

  it('suppresses a snippet that only repeats the title', () => {
    const hit = hydrateHit({
      ...rawHit,
      plain_text: 'Q4 Roadmap',
      _formatted: {
        title: '<mark>Q4</mark> Roadmap',
        plain_text: '<mark>Q4</mark> Roadmap',
      },
    });
    expect(hit?.snippet).toEqual([]);
  });

  it('keeps a snippet that adds information', () => {
    const hit = hydrateHit(rawHit);
    expect(hit?.snippet.length).toBeGreaterThan(0);
    expect(hit?.snippet.some((segment) => segment.highlighted)).toBe(true);
  });

  it('crops nothing when `_formatted` is absent', () => {
    const hit = hydrateHit({
      id: 'y',
      title: 'Plain',
      plain_text: 'Plain body',
    });
    expect(hit?.title).toEqual([{ text: 'Plain', highlighted: false }]);
    expect(hit?.plainTitle).toBe('Plain');
    expect(hit?.type).toBe('text');
    expect(hit?.lastEditedTime).toBe(0);
  });

  it('drops unusable hits', () => {
    expect(hydrateHit({})).toBeNull();
    expect(hydrateHit({ id: '' })).toBeNull();
  });

  it('hydrates batches in order', () => {
    const hits = hydrateHits([rawHit, { id: 'b' }, { id: 'c' }]);
    expect(hits.map((hit) => hit.id)).toEqual(['block-1', 'b', 'c']);
  });
});

/* -------------------------------------------------------------------------- */
/* ACL verification                                                           */
/* -------------------------------------------------------------------------- */

describe('ACL verification', () => {
  const document: SearchDocument = {
    id: 'doc',
    space_id: SPACE_ID,
    parent_id: PROJECTS_PAGE_ID,
    root_page_id: ROADMAP_PAGE_ID,
    type: 'text',
    title: 'T',
    plain_text: 'T',
    created_by: USER_ID,
    last_edited_time: 0,
    ancestor_ids: [ROADMAP_PAGE_ID],
    access_principals: [`user:${USER_ID}`],
    alive: true,
  };

  it('accepts a document inside a readable workspace and tree', () => {
    expect(isDocumentReadable(document, scope)).toBe(true);
  });

  it('rejects a document from another workspace', () => {
    expect(
      isDocumentReadable({ ...document, space_id: OTHER_SPACE_ID }, scope),
    ).toBe(false);
  });

  it('rejects a document from a non-readable tree', () => {
    expect(
      isDocumentReadable({ ...document, root_page_id: OTHER_SPACE_ID }, scope),
    ).toBe(false);
  });

  it('rejects deleted documents', () => {
    expect(isDocumentReadable({ ...document, alive: false }, scope)).toBe(
      false,
    );
  });

  it('accepts a shared sub-tree document via ancestor ids', () => {
    expect(
      isDocumentReadable(
        {
          ...document,
          root_page_id: OTHER_SPACE_ID,
          ancestor_ids: [SHARED_PAGE_ID],
        },
        { ...scope, readableSubtreeIds: [SHARED_PAGE_ID] },
      ),
    ).toBe(true);
  });

  it('enforces explicit principals when supplied', () => {
    expect(
      isDocumentReadable(document, {
        ...scope,
        principals: ['teamspace:other'],
      }),
    ).toBe(false);
    expect(
      isDocumentReadable(document, {
        ...scope,
        principals: ['public', `user:${USER_ID}`],
      }),
    ).toBe(true);
  });

  it('is fail-closed for an empty scope', () => {
    expect(
      isDocumentReadable(document, { userId: USER_ID, spaceIds: [] }),
    ).toBe(false);
    expect(
      isDocumentReadable(document, {
        userId: USER_ID,
        spaceIds: [SPACE_ID],
        readableRootPageIds: [],
      }),
    ).toBe(false);
  });

  it('verifies hydrated hits by workspace and root page', () => {
    expect(
      isQuickFindHitInScope(
        { spaceId: SPACE_ID, rootPageId: ROADMAP_PAGE_ID },
        scope,
      ),
    ).toBe(true);
    expect(
      isQuickFindHitInScope(
        { spaceId: OTHER_SPACE_ID, rootPageId: ROADMAP_PAGE_ID },
        scope,
      ),
    ).toBe(false);
    expect(
      isQuickFindHitInScope(
        { spaceId: SPACE_ID, rootPageId: OTHER_SPACE_ID },
        scope,
      ),
    ).toBe(false);
    // No tree restriction → workspace membership is enough.
    expect(
      isQuickFindHitInScope(
        { spaceId: SPACE_ID, rootPageId: OTHER_SPACE_ID },
        { userId: USER_ID, spaceIds: [SPACE_ID] },
      ),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Search service                                                             */
/* -------------------------------------------------------------------------- */

class RecordingExecutor implements SearchExecutor {
  readonly indexUid = BLOCKS_INDEX_UID;
  readonly calls: { query: string; options: Record<string, unknown> }[] = [];
  response: RawSearchResponse = {
    hits: [
      {
        id: 'hit-1',
        space_id: SPACE_ID,
        root_page_id: ROADMAP_PAGE_ID,
        type: 'page',
        title: 'Q4 Roadmap',
        plain_text: 'Q4 Roadmap',
        _formatted: { title: '<mark>Q4</mark> Roadmap' },
      },
      {
        // Leaked document from another workspace: must be filtered out.
        id: 'hit-2',
        space_id: OTHER_SPACE_ID,
        root_page_id: OTHER_SPACE_ID,
        type: 'page',
        title: 'Secret',
        plain_text: 'Secret',
      },
    ],
    processingTimeMs: 3,
    estimatedTotalHits: 2,
  };
  error: Error | null = null;

  async execute(
    query: string,
    options: Record<string, unknown>,
  ): Promise<RawSearchResponse> {
    this.calls.push({ query, options });
    if (this.error) {
      throw this.error;
    }
    return this.response;
  }
}

describe('QuickFindSearchService', () => {
  it('builds, executes and hydrates a scoped search', async () => {
    const executor = new RecordingExecutor();
    const service = new QuickFindSearchService(executor, { now: () => 1_000 });
    const result = await service.search({ term: ' Q4 ' }, scope);

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.query).toBe('q4');
    expect(String(executor.calls[0]?.options.filter)).toContain('alive = true');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.plainTitle).toBe('Q4 Roadmap');
    expect(result.processingTimeMs).toBe(3);
    expect(result.query).toBe('q4');
  });

  it('drops hits outside the ACL even if the index returns them', async () => {
    const executor = new RecordingExecutor();
    const service = new QuickFindSearchService(executor);
    const result = await service.search({ term: 'x' }, scope);
    expect(result.hits.map((hit) => hit.id)).toEqual(['hit-1']);
  });

  it('never calls the transport when access is denied', async () => {
    const executor = new RecordingExecutor();
    const service = new QuickFindSearchService(executor);
    const result = await service.search(
      { term: 'secret' },
      { userId: USER_ID, spaceIds: [] },
    );
    expect(executor.calls).toHaveLength(0);
    expect(result.denied).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it('reports telemetry for hits and denials', async () => {
    const executor = new RecordingExecutor();
    const events: unknown[] = [];
    const service = new QuickFindSearchService(executor, {
      telemetry: { onResult: (event) => events.push(event) },
    });

    await service.search({ term: 'q4' }, scope);
    await service.search({ term: 'x' }, { userId: USER_ID, spaceIds: [] });

    expect(events).toEqual([
      {
        term: 'q4',
        hits: 1,
        latencyMs: expect.any(Number),
        serverTimeMs: 3,
        denied: false,
      },
      {
        term: 'x',
        hits: 0,
        latencyMs: expect.any(Number),
        serverTimeMs: 0,
        denied: true,
      },
    ]);
  });

  it('swallows aborts and rethrows other failures', async () => {
    const executor = new RecordingExecutor();
    const service = new QuickFindSearchService(executor);

    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    executor.error = abort;
    await expect(service.search({ term: 'x' }, scope)).resolves.toMatchObject({
      hits: [],
    });

    executor.error = new Error('network down');
    await expect(service.search({ term: 'x' }, scope)).rejects.toThrow(
      'network down',
    );
  });

  it('exposes query building without executing', () => {
    const executor = new RecordingExecutor();
    const service = new QuickFindSearchService(executor);
    const query = service.build({ term: 'a' }, scope);
    expect(query.q).toBe('a');
    expect(executor.calls).toHaveLength(0);
  });

  it('fetches recent pages newest-first and scoped', async () => {
    const executor = new RecordingExecutor();
    const service = new QuickFindSearchService(executor);
    const result = await service.recentPages(scope, { limit: 5 });

    expect(executor.calls[0]?.query).toBe('');
    expect(executor.calls[0]?.options.sort).toEqual(['last_edited_time:desc']);
    expect(String(executor.calls[0]?.options.filter)).toContain(
      'type = "page"',
    );
    expect(result.hits).toHaveLength(1);
  });

  it('narrows recent pages to the active workspace', async () => {
    const executor = new RecordingExecutor();
    executor.response = { hits: [], processingTimeMs: 1 };
    const service = new QuickFindSearchService(executor);
    await service.recentPages(scope, { spaceId: OTHER_SPACE_ID, limit: 3 });
    expect(String(executor.calls[0]?.options.filter)).toContain(
      `space_id = "${OTHER_SPACE_ID}"`,
    );
  });

  it('returns a denied recent-pages result without a request', async () => {
    const executor = new RecordingExecutor();
    const service = new QuickFindSearchService(executor);
    const result = await service.recentPages({ userId: USER_ID, spaceIds: [] });
    expect(result.denied).toBe(true);
    expect(executor.calls).toHaveLength(0);
  });
});

describe('isAbortError', () => {
  it('recognises AbortError and code 20', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError({ code: 20 })).toBe(true);
    expect(isAbortError(new Error('nope'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('string')).toBe(false);
  });
});

describe('diffIndexSettings', () => {
  it('returns the full schema when nothing is live', () => {
    expect(diffIndexSettings(undefined)).toEqual(BLOCKS_INDEX_SETTINGS);
  });
});
