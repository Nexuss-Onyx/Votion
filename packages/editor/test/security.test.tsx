import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Block } from '@votion/types';
import { RichTextRenderer } from '../src/richtext/RichTextRenderer.js';
import { MathBlock } from '../src/blocks/MathBlock.js';
import { MediaBlock } from '../src/blocks/MediaBlock.js';
import { renderSafeKatex } from '../src/lib/sanitize.js';
import { createBlockEditor } from '../src/lib/editor.js';

const testEditor = createBlockEditor('space-sec-1');

function makeBlock(partial: Partial<Block>): Block {
  return {
    id: 'block-sec-1',
    space_id: 'space-sec-1',
    version: 1,
    type: 'text',
    properties: {},
    format: {},
    content: [],
    parent_id: 'page-sec-1',
    parent_table: 'block',
    alive: true,
    created_time: 1,
    last_edited_time: 1,
    created_by_id: 'user-1',
    last_edited_by_id: 'user-1',
    ...partial,
  };
}

describe('@votion/editor XSS & iframe sandbox hardening', () => {
  it('blocks javascript: and data: hyperlinks in RichTextRenderer', () => {
    render(
      <RichTextRenderer
        richText={[
          ['Malicious JS', [['a', 'javascript:alert(1)']]],
          ['Malicious Data', [['a', 'data:text/html,<script>alert(1)</script>']]],
          ['Safe Link', [['a', 'https://github.com/Nexuss-Onyx/Votion']]],
        ]}
      />,
    );

    expect(screen.queryByRole('link', { name: 'Malicious JS' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Malicious Data' })).toBeNull();
    expect(screen.getByText('Malicious JS')).toBeInTheDocument();
    const safe = screen.getByRole('link', { name: 'Safe Link' });
    expect(safe).toHaveAttribute('href', 'https://github.com/Nexuss-Onyx/Votion');
    expect(safe).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('sanitizes KaTeX inline and block expressions against javascript: URLs and HTML tags', () => {
    const html = renderSafeKatex(
      '\\href{javascript:alert(1)}{E=mc^2} <script>window.pwned=1</script> \\htmlData{foo=bar}{+1}',
      true,
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('data-foo');
    expect(html).toContain('katex');

    const mathBlock = makeBlock({
      type: 'math',
      properties: {
        title: [['\\url{javascript:alert(1)} x^2 + y^2 = r^2 <img src=x onerror=alert(1)>']],
      },
    });
    const { container } = render(<MathBlock block={mathBlock} editor={testEditor} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('renders sandboxed iframes only for trusted HTTPS embed providers and blocks untrusted origins', () => {
    const trustedYoutube = makeBlock({
      type: 'embed',
      properties: { source: [['https://www.youtube.com/embed/dQw4w9WgXcQ']] },
    });
    const { container: okContainer } = render(
      <MediaBlock block={trustedYoutube} editor={testEditor} />,
    );
    const iframe = okContainer.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');

    const untrusted = makeBlock({
      id: 'block-sec-2',
      type: 'embed',
      properties: { source: [['https://evil.example.com/phishing']] },
    });
    const { container: blockedContainer } = render(
      <MediaBlock block={untrusted} editor={testEditor} />,
    );
    expect(blockedContainer.querySelector('iframe')).toBeNull();
    expect(screen.getByTestId('blocked-embed')).toBeInTheDocument();
  });
});
