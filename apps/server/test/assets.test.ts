import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { makeApp, registerUser } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('POST /api/v3/getUploadFileUrl', () => {
  it('returns a signed direct-upload URL for an allowed MIME type', async () => {
    const app = await makeApp(); apps.push(app);
    const { body: user } = await registerUser(app);
    const response = await app.inject({ method: 'POST', url: '/api/v3/getUploadFileUrl',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { fileName: 'photo.png', contentType: 'image/png', fileSize: 1024, spaceId: user.workspace.id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().uploadUrl).toContain('X-Offline-Signature');
    expect(response.json().publicUrl).toContain('/uploads/');
  });

  it('rejects disallowed MIME types and oversized uploads', async () => {
    const app = await makeApp(); apps.push(app);
    const { body: user } = await registerUser(app);
    const badMime = await app.inject({ method: 'POST', url: '/api/v3/getUploadFileUrl',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { fileName: 'x.exe', contentType: 'application/x-msdownload', fileSize: 10 },
    });
    expect(badMime.statusCode).toBe(400);
    const tooBig = await app.inject({ method: 'POST', url: '/api/v3/getUploadFileUrl',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { fileName: 'large.png', contentType: 'image/png', fileSize: app.config.MAX_UPLOAD_BYTES + 1 },
    });
    expect(tooBig.statusCode).toBe(413);
  });
});
