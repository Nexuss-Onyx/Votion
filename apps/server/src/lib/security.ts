/**
 * Edge security policies for `apps/server`:
 * - Strict CORS origin allowlist supporting `https://*.wasmer.app`
 * - Content Security Policy (CSP) directives for `@fastify/helmet`
 * - Server-side XSS sanitization for Transaction operations (Rich Text, KaTeX, Media URLs)
 */

import {
  type Operation,
  type Transaction,
  TRUSTED_EMBED_FRAME_SRC,
  WASMER_EDGE_CONNECT_SRC,
  sanitizeEmbedUrl,
  sanitizeKatexExpression,
  sanitizePlainText,
  sanitizeRichText,
  sanitizeUrl,
} from '@votion/types';

import type { ServerConfig } from '../config.js';
import type { DataStore } from '../store/types.js';

const DEFAULT_PRODUCTION_ORIGINS = [
  'https://*.wasmer.app',
  'https://votion.app',
  'https://*.votion.app',
];

const DEFAULT_DEV_ORIGINS = [
  ...DEFAULT_PRODUCTION_ORIGINS,
  'https://*.e2b.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

function matchesOriginPattern(origin: string, pattern: string): boolean {
  const normalizedOrigin = origin.trim().toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedOrigin === normalizedPattern) {
    return true;
  }
  // Wildcard port pattern: `http://localhost:*`
  if (normalizedPattern.endsWith(':*')) {
    const prefix = normalizedPattern.slice(0, -2);
    if (normalizedOrigin === prefix) {
      return true;
    }
    if (normalizedOrigin.startsWith(`${prefix}:`)) {
      const port = normalizedOrigin.slice(prefix.length + 1);
      return /^\d{1,5}$/.test(port);
    }
    return false;
  }
  // Wildcard subdomain pattern: `https://*.wasmer.app`
  const wildcardMatch = /^(https?):\/\/\*\.([a-z0-9.-]+)$/.exec(normalizedPattern);
  if (wildcardMatch) {
    const [, scheme, baseDomain] = wildcardMatch;
    const originMatch = /^(https?):\/\/([a-z0-9.-]+)$/.exec(normalizedOrigin);
    if (!originMatch) {
      return false;
    }
    const [, originScheme, originHost] = originMatch;
    if (originScheme !== scheme || !originHost || !baseDomain) {
      return false;
    }
    return (
      originHost.endsWith(`.${baseDomain}`) &&
      originHost.length > baseDomain.length + 1
    );
  }
  return false;
}

/**
 * Evaluates whether a browser `Origin` header is permitted under `config`.
 * Requests without an `Origin` header (CLI, server-to-server, webhooks) pass.
 */
export function isAllowedCorsOrigin(
  origin: string | undefined,
  config: ServerConfig,
): boolean {
  if (!origin) {
    return true;
  }
  const rawConfigured = config.CORS_ORIGIN.trim();
  let patterns: string[];

  if (rawConfigured.length > 0 && rawConfigured !== '*') {
    patterns = rawConfigured
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  } else if (config.NODE_ENV === 'production') {
    // Never allow wildcard `*` reflection with credentials in production.
    patterns = DEFAULT_PRODUCTION_ORIGINS;
  } else if (rawConfigured === '*') {
    return true;
  } else {
    patterns = DEFAULT_DEV_ORIGINS;
  }

  return patterns.some((pattern) => matchesOriginPattern(origin, pattern));
}

/** Builds the Fastify CORS `origin` callback enforcing {@link isAllowedCorsOrigin}. */
export function createCorsOriginHandler(config: ServerConfig) {
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow: boolean) => void,
  ): void => {
    callback(null, isAllowedCorsOrigin(origin, config));
  };
}

/** Builds Helmet Content-Security-Policy directives for the edge HTTP server. */
export function buildHelmetCspDirectives(
  config: ServerConfig,
): Record<string, Iterable<string>> {
  const connectSrc = new Set<string>(WASMER_EDGE_CONNECT_SRC);
  if (config.S3_ENDPOINT) {
    try {
      connectSrc.add(new URL(config.S3_ENDPOINT).origin);
    } catch {
      /* ignore malformed optional endpoint */
    }
  }
  const directives: Record<string, Iterable<string>> = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:'],
    mediaSrc: ["'self'", 'https:'],
    frameSrc: [...TRUSTED_EMBED_FRAME_SRC],
    connectSrc: [...connectSrc],
    frameAncestors: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
  };
  if (config.NODE_ENV === 'production') {
    directives['upgradeInsecureRequests'] = [];
  }
  return directives;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeRichTextTupleArray(value: unknown): value is unknown[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length >= 1 &&
        item.length <= 2 &&
        typeof item[0] === 'string',
    )
  );
}

function sanitizeSourceTuple(raw: unknown, blockType: string | undefined): unknown {
  if (!looksLikeRichTextTupleArray(raw)) {
    if (typeof raw === 'string') {
      return blockType === 'embed'
        ? (sanitizeEmbedUrl(raw) ?? '')
        : (sanitizeUrl(raw, { allowRelative: true, allowMailto: false }) ?? '');
    }
    return raw;
  }
  const firstUrl = typeof raw[0]?.[0] === 'string' ? raw[0][0] : '';
  const safe =
    blockType === 'embed'
      ? (sanitizeEmbedUrl(firstUrl) ?? '')
      : (sanitizeUrl(firstUrl, { allowRelative: true, allowMailto: false }) ?? '');
  return [[safe]];
}

function sanitizeMathRichText(raw: unknown): unknown {
  if (!looksLikeRichTextTupleArray(raw)) {
    if (typeof raw === 'string') {
      return [[sanitizeKatexExpression(raw)]];
    }
    return raw;
  }
  return raw.map((segment) => {
    const expr = typeof segment[0] === 'string' ? sanitizeKatexExpression(segment[0]) : '';
    return [expr];
  });
}

function sanitizePropertyValueByKey(
  key: string,
  value: unknown,
  blockType: string | undefined,
): unknown {
  if (key === 'source') {
    return sanitizeSourceTuple(value, blockType);
  }
  if (key === 'checked' || key === 'language') {
    return value;
  }
  if (key === 'title' && blockType === 'math') {
    return sanitizeMathRichText(value);
  }
  if (looksLikeRichTextTupleArray(value)) {
    return sanitizeRichText(value);
  }
  if (typeof value === 'string') {
    return sanitizePlainText(value);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [subKey, subVal] of Object.entries(value)) {
      if (subKey === 'url' && typeof subVal === 'string') {
        out[subKey] = sanitizeUrl(subVal, { allowRelative: false, allowMailto: true });
      } else if (typeof subVal === 'string') {
        out[subKey] = sanitizePlainText(subVal);
      } else if (looksLikeRichTextTupleArray(subVal)) {
        out[subKey] = sanitizeRichText(subVal);
      } else {
        out[subKey] = subVal;
      }
    }
    return out;
  }
  return value;
}

function sanitizeOperation(operation: Operation, blockType: string | undefined): Operation {
  const { path, command, args } = operation;
  const root = path[0];

  if (command === 'set') {
    if (root === 'properties' && path.length === 1 && isPlainObject(args)) {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        cleaned[k] = sanitizePropertyValueByKey(k, v, blockType);
      }
      return { ...operation, args: cleaned };
    }
    if (root === 'properties' && typeof path[1] === 'string') {
      return {
        ...operation,
        args: sanitizePropertyValueByKey(path[1], args, blockType),
      };
    }
    if ((root === 'name' || root === 'description') && looksLikeRichTextTupleArray(args)) {
      return { ...operation, args: sanitizeRichText(args) };
    }
    return operation;
  }

  if (command === 'update' && root === 'properties' && path.length === 1 && isPlainObject(args)) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      cleaned[k] = sanitizePropertyValueByKey(k, v, blockType);
    }
    return { ...operation, args: cleaned };
  }

  if (command === 'keyedObjectSet' && root === 'properties' && path.length === 1 && isPlainObject(args)) {
    const key = typeof args['key'] === 'string' ? args['key'] : '';
    if (key) {
      return {
        ...operation,
        args: {
          ...args,
          value: sanitizePropertyValueByKey(key, args['value'], blockType),
        },
      };
    }
  }

  return operation;
}

/**
 * Sanitizes Rich Text, KaTeX math expressions, and media/embed URLs across a
 * batch of client transactions before persisting them to storage.
 */
export async function sanitizeTransactions(
  transactions: readonly Transaction[],
  store: DataStore,
): Promise<Transaction[]> {
  const blockTypes = new Map<string, string | undefined>();

  // Pre-collect block types from operations that set `type` in the same batch
  // or from existing persisted blocks.
  for (const tx of transactions) {
    for (const op of tx.operations) {
      if (op.pointer.table !== 'block') {
        continue;
      }
      if (op.command === 'set' && op.path.length === 1 && op.path[0] === 'type' && typeof op.args === 'string') {
        blockTypes.set(op.pointer.id, op.args);
      } else if (op.command === 'update' && op.path.length === 0 && isPlainObject(op.args) && typeof op.args['type'] === 'string') {
        blockTypes.set(op.pointer.id, op.args['type']);
      }
    }
  }

  for (const tx of transactions) {
    for (const op of tx.operations) {
      if (op.pointer.table === 'block' && !blockTypes.has(op.pointer.id)) {
        const existing = await store.findBlockById(op.pointer.id);
        blockTypes.set(op.pointer.id, existing?.type);
      }
    }
  }

  return transactions.map((tx) => ({
    ...tx,
    operations: tx.operations.map((op) =>
      sanitizeOperation(
        op,
        op.pointer.table === 'block' ? blockTypes.get(op.pointer.id) : undefined,
      ),
    ),
  }));
}
