import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Block } from '@votion/types';

import { buildWebSecurityHeaders } from '@/lib/securityHeaders';
import { PageBodyRenderer } from '@/components/page/PageBodyRenderer';
import { cleanup, installFreshStore, restoreDefaultStore } from './helpers';
import { render } from '@testing-library/react';
import { WorkspaceProvider } from '@/state/WorkspaceProvider';

afterEach(() => {
  cleanup();
  restoreDefaultStore();
});

describe('Next.js edge CSP & PageBodyRenderer XSS hardening', () => {
  it('generates strict CSP headers allowing trusted embed iframes and Wasmer Edge connect-src', () => {
    const headers = buildWebSecurityHeaders({
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: 'https://votion-app.wasmer.app',
      NEXT_PUBLIC_WS_URL: 'wss://votion-sync.wasmer.app',
    });

    const byKey = new Map(headers.map((entry) => [entry.key, entry.value]));
    const csp = byKey.get('Content-Security-Policy') ?? '';

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://www.youtube.com');
    expect(csp).toContain('https://www.figma.com');
    expect(csp).toContain('https://github.com');
    expect(csp).toContain('https://codepen.io');
    expect(csp).toContain('https://*.wasmer.app');
    expect(csp).toContain('wss://*.wasmer.app');
    expect(csp).toContain('wss://votion-sync.wasmer.app');
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('strips javascript: links and <script> tags in PageBodyRenderer', () => {
    const page: Block = {
      id: 'page-sec',
      space_id: 'space-sec',
      version: 1,
      type: 'page',
      properties: { title: [['Security Page']] },
      format: {},
      content: ['child-sec'],
      parent_id: 'space-sec',
      parent_table: 'space',
      alive: true,
      created_time: 1,
      last_edited_time: 1,
      created_by_id: 'u1',
      last_edited_by_id: 'u1',
    };
    const child: Block = {
      id: 'child-sec',
      space_id: 'space-sec',
      version: 1,
      type: 'text',
      properties: {
        title: [
          ['Hello<script>alert(1)</script>', [['a', 'javascript:alert(1)']]],
          [' Docs', [['a', 'https://votion.dev/docs']]],
        ],
      },
      format: {},
      content: [],
      parent_id: 'page-sec',
      parent_table: 'block',
      alive: true,
      created_time: 1,
      last_edited_time: 1,
      created_by_id: 'u1',
      last_edited_by_id: 'u1',
    };

    const store = installFreshStore();
    store.getState().setRecord('block', page);
    store.getState().setRecord('block', child);

    render(
      <WorkspaceProvider seed={false}>
        <PageBodyRenderer
          page={page}
          comments={[]}
          isSmallText={false}
          onHighlightClick={vi.fn()}
        />
      </WorkspaceProvider>,
    );

    expect(screen.queryByRole('link', { name: /Hello/i })).toBeNull();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    const docsLink = screen.getByRole('link', { name: 'Docs' });
    expect(docsLink).toHaveAttribute('href', 'https://votion.dev/docs');
    expect(docsLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
