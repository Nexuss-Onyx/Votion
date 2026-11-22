import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/app.js';
import { hasObjectStorage, loadConfig } from '../src/config.js';
import { InMemoryStore } from '../src/store/memory.js';
import { addBlock, registerUser } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Phase 12 edge security hardening & Wasmer pipeline', () => {
  it('sets strict Content-Security-Policy and security headers on API responses', async () => {
    const serverConfig = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-jwt-secret-at-least-16-chars',
    });
    const app = await buildServer({
      config: serverConfig,
      store: new InMemoryStore(),
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    const csp = String(response.headers['content-security-policy'] ?? '');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://www.youtube.com');
    expect(csp).toContain('https://www.figma.com');
    expect(csp).toContain('https://github.com');
    expect(csp).toContain('https://codepen.io');
    expect(csp).toContain('https://*.wasmer.app');
    expect(csp).toContain('wss://*.wasmer.app');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('enforces strict CORS origins on Wasmer Edge and blocks untrusted origins', async () => {
    const serverConfig = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-jwt-secret-at-least-16-chars',
      CORS_ORIGIN: 'https://*.wasmer.app,https://app.votion.dev',
    });
    const app = await buildServer({
      config: serverConfig,
      store: new InMemoryStore(),
      logger: false,
    });
    apps.push(app);

    const allowedWasmer = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://votion-edge.wasmer.app' },
    });
    expect(allowedWasmer.headers['access-control-allow-origin']).toBe(
      'https://votion-edge.wasmer.app',
    );

    const blockedAttacker = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://attacker.example.com' },
    });
    expect(blockedAttacker.headers['access-control-allow-origin']).toBeUndefined();

    const blockedSpoof = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://wasmer.app.attacker.com' },
    });
    expect(blockedSpoof.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('enforces strict rate limiting on sensitive authentication endpoints', async () => {
    const serverConfig = loadConfig({
      NODE_ENV: 'test',
      AUTH_RATE_LIMIT_MAX: '3',
      RATE_LIMIT_WINDOW: '1 minute',
    });
    const app = await buildServer({
      config: serverConfig,
      store: new InMemoryStore(),
      logger: false,
    });
    apps.push(app);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.test', password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    }

    const throttled = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.test', password: 'wrong-password' },
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['retry-after']).toBeDefined();
  });

  it('sanitizes Rich Text, KaTeX expressions, and untrusted embed URLs in saveTransactions', async () => {
    const store = new InMemoryStore();
    const app = await buildServer({
      config: loadConfig({ NODE_ENV: 'test' }),
      store,
      logger: false,
    });
    apps.push(app);

    const { body: auth } = await registerUser(app);
    const spaceId = auth.workspace.id;

    const textBlock = await addBlock(store, spaceId);
    const mathBlock = await store.createBlock({
      spaceId,
      type: 'math',
      parentId: spaceId,
      parentTable: 'space',
      content: [],
      properties: { title: [['x^2']] },
      createdById: auth.user.id,
    });
    const embedBlock = await store.createBlock({
      spaceId,
      type: 'embed',
      parentId: spaceId,
      parentTable: 'space',
      content: [],
      properties: { source: [['https://www.youtube.com/embed/abc']] },
      createdById: auth.user.id,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v3/saveTransactions',
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: {
        requestId: randomUUID(),
        transactions: [
          {
            id: randomUUID(),
            spaceId,
            operations: [
              {
                pointer: { table: 'block', id: textBlock.id, spaceId },
                path: ['properties', 'title'],
                command: 'set',
                args: [
                  ['Safe<script>evil()</script>', [['a', 'javascript:alert(1)'], ['b']]],
                  ['Link', [['a', 'https://github.com/Nexuss-Onyx/Votion']]],
                ],
              },
              {
                pointer: { table: 'block', id: mathBlock.id, spaceId },
                path: ['properties', 'title'],
                command: 'set',
                args: [['\\href{javascript:alert(1)}{E=mc^2} \\htmlData{x=1}{+1} <img src=x onerror=alert(1)>']],
              },
              {
                pointer: { table: 'block', id: embedBlock.id, spaceId },
                path: ['properties', 'source'],
                command: 'set',
                args: [['https://malicious.example.com/frame']],
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);

    const savedText = await store.findBlockById(textBlock.id);
    expect(savedText?.properties['title']).toEqual([
      ['Safe', [['b']]],
      ['Link', [['a', 'https://github.com/Nexuss-Onyx/Votion']]],
    ]);

    const savedMath = await store.findBlockById(mathBlock.id);
    const savedLatex = String((savedMath?.properties['title'] as string[][] | undefined)?.[0]?.[0] ?? '');
    expect(savedLatex).not.toContain('javascript:');
    expect(savedLatex).not.toContain('\\htmlData');
    expect(savedLatex).not.toContain('<img');
    expect(savedLatex).toContain('E=mc^2');

    const savedEmbed = await store.findBlockById(embedBlock.id);
    expect(savedEmbed?.properties['source']).toEqual([['']]);
  });

  it('normalizes Wasmer Edge S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET secrets in loadConfig', () => {
    const cfg = loadConfig({
      NODE_ENV: 'test',
      S3_ENDPOINT: 'https://r2.votion.example.com',
      S3_ACCESS_KEY: 'edge-access-key',
      S3_SECRET_KEY: 'edge-secret-key',
      S3_BUCKET: 'votion-edge-bucket',
    });
    expect(hasObjectStorage(cfg)).toBe(true);
    expect(cfg.S3_ACCESS_KEY_ID).toBe('edge-access-key');
    expect(cfg.S3_SECRET_ACCESS_KEY).toBe('edge-secret-key');
    expect(cfg.S3_BUCKET_NAME).toBe('votion-edge-bucket');
  });

  it('validates root wasmer.toml and tooling/wasmer/deploy.sh remote build workflow', () => {
    const repoRoot = resolve(import.meta.dirname, '../../..');
    const manifest = readFileSync(join(repoRoot, 'wasmer.toml'), 'utf8');
    expect(manifest).toContain('license = "MIT"');
    expect(manifest).toContain('routes = ["/*"]');
    for (const secret of [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
    ]) {
      expect(manifest).toContain(`secret = "${secret}"`);
    }

    const deployScript = join(repoRoot, 'tooling/wasmer/deploy.sh');

    // 1. Dry-run succeeds with exit 0 even without WASMER_TOKEN.
    const dryRunOut = execFileSync('bash', [deployScript, '--dry-run'], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' },
      encoding: 'utf8',
    });
    expect(dryRunOut).toContain('--build-remote');

    // 2. Live execution with a stubbed `wasmer` binary invokes `deploy --build-remote` and logs URL.
    const sandbox = mkdtempSync(join(tmpdir(), 'votion-wasmer-test-'));
    try {
      const binDir = join(sandbox, '.wasmer', 'bin');
      execFileSync('mkdir', ['-p', binDir]);
      const fakeWasmer = join(binDir, 'wasmer');
      writeFileSync(
        fakeWasmer,
        '#!/usr/bin/env bash\necho "Args: $*"\necho "Deployed to https://votion-app.wasmer.app"\n',
        'utf8',
      );
      chmodSync(fakeWasmer, 0o755);

      const liveOut = execFileSync('bash', [deployScript, '--non-interactive'], {
        cwd: repoRoot,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: sandbox,
          WASMER_TOKEN: 'test-ephemeral-token-not-real',
        },
        encoding: 'utf8',
      });
      expect(liveOut).toContain('Args: deploy --build-remote --non-interactive');
      expect(liveOut).toContain('Live Edge URL: https://votion-app.wasmer.app');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
