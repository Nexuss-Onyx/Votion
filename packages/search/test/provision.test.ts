/**
 * Provisioning CLI argument parsing + exit-code contract.
 */

import { describe, expect, it, vi } from 'vitest';

import { parseProvisionArgs, provision } from '../src/scripts/provision.js';

describe('parseProvisionArgs', () => {
  it('defaults to the shared index, waiting for tasks', () => {
    expect(parseProvisionArgs([])).toEqual({});
  });

  it('parses the tenant in both spellings', () => {
    expect(parseProvisionArgs(['--tenant', 'eu'])).toEqual({ tenant: 'eu' });
    expect(parseProvisionArgs(['--tenant=eu-west'])).toEqual({
      tenant: 'eu-west',
    });
    // A missing value is ignored rather than swallowing the next flag.
    expect(parseProvisionArgs(['--tenant', '--no-wait'])).toEqual({
      noWait: true,
    });
  });

  it('ignores unknown flags', () => {
    expect(parseProvisionArgs(['--verbose', '--tenant', 'us'])).toEqual({
      tenant: 'us',
    });
  });
});

describe('provision', () => {
  it('exits non-zero with a helpful message when the environment is missing', async () => {
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const previousHost = process.env.MEILISEARCH_HOST;
    const previousKey = process.env.MEILISEARCH_API_KEY;
    delete process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_API_KEY;

    try {
      await expect(provision()).resolves.toBe(1);
      const output = stderr.mock.calls.map((call) => String(call[0])).join('');
      expect(output).toContain('MEILISEARCH_HOST');
    } finally {
      if (previousHost !== undefined) {
        process.env.MEILISEARCH_HOST = previousHost;
      }
      if (previousKey !== undefined) {
        process.env.MEILISEARCH_API_KEY = previousKey;
      }
      stderr.mockRestore();
    }
  });
});
