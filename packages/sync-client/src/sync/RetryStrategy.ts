/**
 * Exponential backoff for outbox flushing.
 *
 * Connectivity in the real world is not binary: a phone loses a tunnel, a
 * serverless function cold-starts, a proxy returns 502 for two seconds. Retrying
 * immediately burns battery and thundering-herds the API, so the sync manager
 * asks this class for the delay before each attempt.
 *
 * The formula is the classic "full jitter" backoff (AWS Architecture Blog):
 *
 * ```text
 * delay(n) = random(0, min(cap, base * 2^n))
 * ```
 *
 * Full jitter — rather than adding jitter on top of the exponential — is what
 * keeps a workspace of 200 reconnecting tabs from synchronising in lockstep.
 */

/** Options accepted by {@link RetryStrategy}. */
export interface RetryStrategyOptions {
  /** Delay of the first retry in milliseconds. */
  baseDelayMs?: number;
  /** Upper bound of any single delay in milliseconds. */
  maxDelayMs?: number;
  /** Attempts after which the queue stops retrying automatically (0 = forever). */
  maxAttempts?: number;
  /** Random source (injectable for deterministic tests). */
  random?: () => number;
  /** Clock (injectable for deterministic tests). */
  now?: () => number;
}

/** Snapshot of a retry decision. */
export interface RetryDecision {
  /** Whether another attempt should be scheduled at all. */
  shouldRetry: boolean;
  /** Delay before the next attempt (milliseconds, `0` when not retrying). */
  delayMs: number;
  /** 1-based number of the attempt being scheduled. */
  attempt: number;
  /** Epoch ms at which the next attempt becomes eligible. */
  nextAttemptAt: number;
  /** Human-readable explanation (surfaced in dev tools). */
  reason: string;
}

/** Error classification used to decide *whether* a retry is worthwhile. */
export type RetryableErrorKind =
  | 'network'
  | 'timeout'
  | 'server'
  | 'rate_limit'
  | 'client'
  | 'auth'
  | 'unknown';

/**
 * Maps an HTTP status (or transport error) onto a retry policy.
 *
 * 4xx responses are terminal apart from 408/425/429: retrying a 403 or a 422 will
 * never succeed and would wedge the outbox head, which blocks *every* later
 * transaction behind it.
 */
export function classifyError(error: unknown): RetryableErrorKind {
  if (error && typeof error === 'object') {
    const candidate = error as {
      status?: unknown;
      statusCode?: unknown;
      name?: unknown;
      code?: unknown;
    };
    const status =
      typeof candidate.status === 'number'
        ? candidate.status
        : candidate.statusCode;
    if (typeof status === 'number') {
      if (status === 408 || status === 425) {
        return 'timeout';
      }
      if (status === 429) {
        return 'rate_limit';
      }
      if (status === 401 || status === 403) {
        return 'auth';
      }
      if (status >= 500) {
        return 'server';
      }
      if (status >= 400) {
        return 'client';
      }
    }
    if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') {
      return 'timeout';
    }
    if (
      candidate.name === 'TypeError' ||
      candidate.code === 'ECONNRESET' ||
      candidate.code === 'ENOTFOUND'
    ) {
      return 'network';
    }
  }
  return 'unknown';
}

/** True when the error kind is worth retrying. */
export function isRetryable(kind: RetryableErrorKind): boolean {
  return (
    kind === 'network' ||
    kind === 'timeout' ||
    kind === 'server' ||
    kind === 'rate_limit' ||
    kind === 'unknown'
  );
}

/**
 * Computes retry delays for outbox flushes.
 *
 * One instance lives on the `SyncManager`; its `attempt` counter resets after a
 * successful flush so a long-lived session recovers its fast path.
 */
export class RetryStrategy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private attempt = 0;

  constructor(options: RetryStrategyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 0;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /** Number of consecutive failures recorded so far. */
  get attempts(): number {
    return this.attempt;
  }

  /** Resets the backoff ladder (call after a successful dispatch). */
  reset(): void {
    this.attempt = 0;
  }

  /** Records a failure and returns the decision for the next attempt. */
  next(error?: unknown): RetryDecision {
    this.attempt += 1;
    const kind = error === undefined ? 'unknown' : classifyError(error);

    if (!isRetryable(kind)) {
      return {
        shouldRetry: false,
        delayMs: 0,
        attempt: this.attempt,
        nextAttemptAt: this.now(),
        reason: `non-retryable ${kind} error`,
      };
    }

    if (this.maxAttempts > 0 && this.attempt > this.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        attempt: this.attempt,
        nextAttemptAt: this.now(),
        reason: `exhausted ${this.maxAttempts} attempts`,
      };
    }

    const ceiling = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** (this.attempt - 1),
    );
    const delayMs = Math.round(this.random() * ceiling);
    return {
      shouldRetry: true,
      delayMs,
      attempt: this.attempt,
      nextAttemptAt: this.now() + delayMs,
      reason: `${kind} error, attempt ${this.attempt}`,
    };
  }

  /** Peeks the delay of the given attempt without changing internal state. */
  delayFor(attempt: number): number {
    if (attempt <= 0) {
      return 0;
    }
    const ceiling = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** (attempt - 1),
    );
    return Math.round(this.random() * ceiling);
  }

  /** Maximum delay this strategy will ever schedule. */
  get cap(): number {
    return this.maxDelayMs;
  }

  /** Base delay of the first retry. */
  get base(): number {
    return this.baseDelayMs;
  }
}
