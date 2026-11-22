/**
 * RetryStrategy: exponential backoff, jitter and error classification.
 */

import { describe, expect, it } from 'vitest';

import { RetryStrategy, classifyError, isRetryable } from '../src/index.js';

describe('classifyError', () => {
  it('classifies HTTP statuses', () => {
    expect(classifyError({ status: 500 })).toBe('server');
    expect(classifyError({ status: 503 })).toBe('server');
    expect(classifyError({ status: 429 })).toBe('rate_limit');
    expect(classifyError({ status: 408 })).toBe('timeout');
    expect(classifyError({ status: 425 })).toBe('timeout');
    expect(classifyError({ status: 401 })).toBe('auth');
    expect(classifyError({ status: 403 })).toBe('auth');
    expect(classifyError({ status: 422 })).toBe('client');
  });

  it('classifies transport errors', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyError({ name: 'AbortError' })).toBe('timeout');
    expect(classifyError({ name: 'TimeoutError' })).toBe('timeout');
    expect(classifyError({ code: 'ECONNRESET' })).toBe('network');
    expect(classifyError({ code: 'ENOTFOUND' })).toBe('network');
    expect(classifyError('plain string')).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
  });

  it('marks only transient failures retryable', () => {
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('timeout')).toBe(true);
    expect(isRetryable('server')).toBe(true);
    expect(isRetryable('rate_limit')).toBe(true);
    expect(isRetryable('unknown')).toBe(true);
    // Terminal: retrying these would wedge the outbox head forever.
    expect(isRetryable('client')).toBe(false);
    expect(isRetryable('auth')).toBe(false);
  });
});

describe('RetryStrategy — backoff ladder', () => {
  it('grows exponentially with a full-jitter ceiling', () => {
    const strategy = new RetryStrategy({
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      random: () => 1,
      now: () => 0,
    });

    expect(strategy.next().delayMs).toBe(100);
    expect(strategy.next().delayMs).toBe(200);
    expect(strategy.next().delayMs).toBe(400);
    expect(strategy.next().delayMs).toBe(800);
    expect(strategy.next().delayMs).toBe(1600);
  });

  it('caps the delay at maxDelayMs', () => {
    const strategy = new RetryStrategy({
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      random: () => 1,
      now: () => 0,
    });
    const delays = Array.from({ length: 8 }, () => strategy.next().delayMs);
    expect(Math.max(...delays)).toBe(4000);
  });

  it('applies jitter (delay is within the exponential ceiling)', () => {
    const strategy = new RetryStrategy({
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
      random: () => 0.5,
    });
    expect(strategy.next().delayMs).toBe(500);
    expect(strategy.next().delayMs).toBe(1000);
  });

  it('reports the next attempt time from the injected clock', () => {
    let clock = 10_000;
    const strategy = new RetryStrategy({
      baseDelayMs: 500,
      random: () => 1,
      now: () => clock,
    });

    const decision = strategy.next(new TypeError('offline'));
    expect(decision.shouldRetry).toBe(true);
    expect(decision.attempt).toBe(1);
    expect(decision.nextAttemptAt).toBe(10_500);
    expect(decision.reason).toContain('network');

    clock = 20_000;
    expect(strategy.next().nextAttemptAt).toBe(21_000);
  });

  it('stops retrying on terminal errors', () => {
    const strategy = new RetryStrategy({ random: () => 1 });
    const decision = strategy.next({ status: 403 });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.delayMs).toBe(0);
    expect(decision.reason).toContain('auth');
  });

  it('stops after maxAttempts', () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      baseDelayMs: 10,
      random: () => 1,
    });
    expect(strategy.next().shouldRetry).toBe(true);
    expect(strategy.next().shouldRetry).toBe(true);
    expect(strategy.next().shouldRetry).toBe(true);
    const exhausted = strategy.next();
    expect(exhausted.shouldRetry).toBe(false);
    expect(exhausted.reason).toContain('exhausted');
  });

  it('reset() returns to the fast path', () => {
    const strategy = new RetryStrategy({ baseDelayMs: 100, random: () => 1 });
    strategy.next();
    strategy.next();
    expect(strategy.attempts).toBe(2);
    strategy.reset();
    expect(strategy.attempts).toBe(0);
    expect(strategy.next().delayMs).toBe(100);
  });

  it('delayFor peeks without advancing state', () => {
    const strategy = new RetryStrategy({
      baseDelayMs: 250,
      maxDelayMs: 1000,
      random: () => 1,
    });
    expect(strategy.delayFor(0)).toBe(0);
    expect(strategy.delayFor(1)).toBe(250);
    expect(strategy.delayFor(2)).toBe(500);
    expect(strategy.delayFor(9)).toBe(1000);
    expect(strategy.attempts).toBe(0);
  });

  it('exposes its base and cap', () => {
    const strategy = new RetryStrategy({
      baseDelayMs: 750,
      maxDelayMs: 20_000,
    });
    expect(strategy.base).toBe(750);
    expect(strategy.cap).toBe(20_000);
  });

  it('defaults to a 500 ms base and a 30 s cap', () => {
    const strategy = new RetryStrategy({ random: () => 1 });
    expect(strategy.base).toBe(500);
    expect(strategy.cap).toBe(30_000);
  });
});
