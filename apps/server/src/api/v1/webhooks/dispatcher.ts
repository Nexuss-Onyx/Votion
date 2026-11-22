/**
 * Webhook dispatcher (Phase 11).
 *
 * On a database mutation the server loads every active subscription for the
 * space, builds a `{ event, data, timestamp }` payload, signs it with the
 * subscription secret using HMAC-SHA256, and POSTs it with exponential backoff
 * (3 retries by default). Every attempt outcome is persisted for auditing.
 */

import type { UUID } from '@votion/types';

import type { DataStore, WebhookSubscriptionRecord } from '../../../store/types.js';
import { signPayload } from './signature.js';

/** Minimal fetch surface used by the dispatcher (injectable in tests). */
export type WebhookFetchResult = { ok: boolean; status: number };

export type WebhookFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<WebhookFetchResult>;

/** Outcome of one subscription dispatch. */
export interface WebhookDispatchResult {
  subscriptionId: UUID;
  url: string;
  event: string;
  signature: string;
  body: string;
  attempts: number;
  ok: boolean;
  status: number | null;
  error?: string;
}

/** Options controlling retry/backoff behaviour. */
export interface WebhookDispatcherOptions {
  /** Retries after the initial attempt (default 3 → up to 4 attempts). */
  maxRetries?: number;
  /** Base backoff delay in milliseconds (default 500). */
  initialDelayMs?: number;
  /** Upper bound for a single backoff delay (default 10s). */
  maxDelayMs?: number;
  /** Per-attempt timeout in milliseconds (default 10s). */
  timeoutMs?: number;
  /** Fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: WebhookFetch;
  /** Sleep implementation (injectable in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Optional logger for diagnostics. */
  logger?: { error?: (message: string, meta?: Record<string, unknown>) => void };
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const defaultFetch: WebhookFetch = async (url, init) => {
  const response = await fetch(url, init as RequestInit);
  return { ok: response.ok, status: response.status };
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The signed webhook envelope. */
export function buildWebhookPayload(
  event: string,
  data: unknown,
  timestamp: Date = new Date(),
): { event: string; data: unknown; timestamp: string } {
  return { event, data, timestamp: timestamp.toISOString() };
}

/** HMAC-SHA256 webhook dispatcher with exponential backoff. */
export class WebhookDispatcher {
  private readonly store: DataStore;
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: WebhookFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger?: WebhookDispatcherOptions['logger'];

  constructor(store: DataStore, options: WebhookDispatcherOptions = {}) {
    this.store = store;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger;
  }

  /** Dispatches `event` to every active subscription in `spaceId`. */
  async dispatch(spaceId: UUID, event: string, data: unknown): Promise<WebhookDispatchResult[]> {
    const subscriptions = await this.store.listActiveWebhookSubscriptions(spaceId, [event]);
    return Promise.all(
      subscriptions.map((subscription) => this.dispatchTo(subscription, event, data)),
    );
  }

  /** Dispatches `event` to a single subscription. */
  async dispatchTo(
    subscription: WebhookSubscriptionRecord,
    event: string,
    data: unknown,
  ): Promise<WebhookDispatchResult> {
    return this.post(subscription.id, subscription.url, subscription.secret, event, data);
  }

  /** Dispatches to an arbitrary URL (used by automation actions). */
  async dispatchToUrl(
    url: string,
    secret: string,
    event: string,
    data: unknown,
  ): Promise<WebhookDispatchResult> {
    return this.post(null, url, secret, event, data);
  }

  private async post(
    subscriptionId: UUID | null,
    url: string,
    secret: string,
    event: string,
    data: unknown,
  ): Promise<WebhookDispatchResult> {
    const payload = buildWebhookPayload(event, data);
    const body = JSON.stringify(payload);
    const signature = signPayload(body, secret);
    const maxAttempts = 1 + Math.max(0, this.maxRetries);

    let attempts = 0;
    let ok = false;
    let status: number | null = null;
    let error: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        const result = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Votion-Webhook/1.0',
            'x-votion-event': event,
            'x-votion-signature': signature,
            'x-votion-attempt': String(attempt),
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = result.status;
        if (result.ok) {
          ok = true;
          error = undefined;
          break;
        }
        error = `Webhook endpoint responded with HTTP ${result.status}.`;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      if (attempt < maxAttempts) {
        const delay = Math.min(
          this.maxDelayMs,
          this.initialDelayMs * 2 ** (attempt - 1),
        );
        await this.sleep(delay);
      }
    }

    const result: WebhookDispatchResult = {
      subscriptionId: subscriptionId ?? ('' as UUID),
      url,
      event,
      signature,
      body,
      attempts,
      ok,
      status,
      error,
    };

    if (subscriptionId) {
      try {
        await this.store.createWebhookDelivery({
          subscriptionId,
          event,
          payload,
          signature,
          attempts,
          responseStatus: status,
          error: ok ? null : error ?? null,
        });
      } catch (caught) {
        this.logger?.error?.('failed to persist webhook delivery', {
          subscriptionId,
          error: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }

    if (!ok) {
      this.logger?.error?.('webhook delivery failed', {
        subscriptionId,
        url,
        event,
        attempts,
        status,
        error,
      });
    }
    return result;
  }

  /** Returns recorded deliveries for a subscription (audit trail). */
  async listDeliveries(subscriptionId: UUID) {
    return this.store.listWebhookDeliveries(subscriptionId);
  }
}
