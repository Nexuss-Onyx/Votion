import { describe, expect, it } from 'vitest';

import {
  TRUSTED_EMBED_FRAME_SRC,
  buildContentSecurityPolicy,
  isTrustedEmbedUrl,
  sanitizeEmbedUrl,
  sanitizeKatexExpression,
  sanitizeKatexHtml,
  sanitizePlainText,
  sanitizeRichText,
  sanitizeUrl,
  stripControlChars,
} from '../src/index.js';

describe('URL & iframe embed sanitization', () => {
  it('permits safe http(s), mailto, and relative URLs', () => {
    expect(sanitizeUrl('https://votion.dev/docs?tab=1#top')).toBe(
      'https://votion.dev/docs?tab=1#top',
    );
    expect(sanitizeUrl('http://localhost:3000/api/health')).toBe(
      'http://localhost:3000/api/health',
    );
    expect(sanitizeUrl('mailto:team@votion.dev')).toBe('mailto:team@votion.dev');
    expect(sanitizeUrl('/workspace/page-1')).toBe('/workspace/page-1');
    expect(sanitizeUrl('#heading-2')).toBe('#heading-2');
  });

  it('blocks javascript:, data:, vbscript:, control-char obfuscation, and protocol-relative URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('  \u0000JaVa\tScRiPt:alert(document.cookie)')).toBeNull();
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeUrl('//evil.example.com/payload.js')).toBeNull();
    expect(sanitizeUrl('/\\evil.example.com')).toBeNull();
    expect(sanitizeUrl('https://youtube.com@evil.example.com/embed')).toBeNull();
  });

  it('restricts sandboxed iframe embeds strictly to trusted HTTPS providers', () => {
    expect(sanitizeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    );
    expect(sanitizeEmbedUrl('https://www.figma.com/embed?embed_host=votion')).toBe(
      'https://www.figma.com/embed?embed_host=votion',
    );
    expect(sanitizeEmbedUrl('https://gist.github.com/Nexuss-Onyx/12345')).toBe(
      'https://gist.github.com/Nexuss-Onyx/12345',
    );
    expect(sanitizeEmbedUrl('https://codepen.io/pen/embed/abcdef')).toBe(
      'https://codepen.io/pen/embed/abcdef',
    );
    expect(isTrustedEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);

    // Reject HTTP, untrusted domains, subdomain spoofing, non-standard ports, and scripts.
    expect(sanitizeEmbedUrl('http://www.youtube.com/embed/dQw4w9WgXcQ')).toBeNull();
    expect(sanitizeEmbedUrl('https://youtube.com.evil.example/embed/1')).toBeNull();
    expect(sanitizeEmbedUrl('https://evil-youtube.com/embed/1')).toBeNull();
    expect(sanitizeEmbedUrl('https://www.youtube.com:8443/embed/1')).toBeNull();
    expect(sanitizeEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(isTrustedEmbedUrl('https://untrusted.example.com/frame')).toBe(false);
  });
});

describe('Rich Text & KaTeX XSS sanitization', () => {
  it('strips executable HTML tags while preserving mathematical inequalities and code generics', () => {
    expect(sanitizePlainText('Hello <script>alert(1)</script>world')).toBe('Hello world');
    expect(sanitizePlainText('Click <img src=x onerror=alert(1)>here')).toBe('Click here');
    expect(sanitizePlainText('<svg onload="alert(1)">ok')).toBe('ok');
    expect(sanitizePlainText('0 < x && x > -5 with Array<string>')).toBe(
      '0 < x && x > -5 with Array<string>',
    );
    expect(stripControlChars('ab\u0000cd\u0007ef\ng')).toBe('abcdef\ng');
  });

  it('sanitizes rich text segments, dropping malicious links and invalid highlight tokens', () => {
    const dirty = [
      ['Safe link', [['a', 'https://github.com/Nexuss-Onyx/Votion'], ['b']]],
      ['XSS<script>evil()</script>', [['a', 'javascript:alert(1)'], ['i']]],
      ['Spoofed class', [['h', 'red" onclick="alert(1)']]],
      ['Inline math', [['e', '\\href{javascript:alert(1)}{E=mc^2}\\htmlData{x=1}{+1}']]],
    ];

    const sanitized = sanitizeRichText(dirty);
    expect(sanitized).toEqual([
      ['Safe link', [['a', 'https://github.com/Nexuss-Onyx/Votion'], ['b']]],
      ['XSS', [['i']]],
      ['Spoofed class'],
      ['Inline math', [['e', 'E=mc^2{+1}']]],
    ]);
  });

  it('neutralizes malicious KaTeX macros and strips unsafe post-render HTML attributes', () => {
    const expr = sanitizeKatexExpression(
      '\\frac{1}{2} \\url{javascript:alert(1)} \\htmlStyle{color:red}{x} <script>alert(1)</script> \\write18{rm -rf /}',
    );
    expect(expr).not.toContain('javascript:');
    expect(expr).not.toContain('\\htmlStyle');
    expect(expr).not.toContain('<script');
    expect(expr).not.toContain('\\write18');
    expect(expr).toContain('\\frac{1}{2}');

    const html = sanitizeKatexHtml(
      '<span class="katex" onmouseover="alert(1)"><a href="javascript:alert(1)">x</a><script>bad()</script></span>',
    );
    expect(html).toBe('<span class="katex"><a>x</a></span>');
  });
});

describe('Content Security Policy builder', () => {
  it('restricts script-src, frame-src to trusted providers, and connect-src to Wasmer Edge', () => {
    const csp = buildContentSecurityPolicy({
      allowInlineScripts: false,
      upgradeInsecureRequests: true,
      extraConnectSrc: ['https://ms-votion.meilisearch.io'],
    });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain('https://*.wasmer.app');
    expect(csp).toContain('wss://*.wasmer.app');
    expect(csp).toContain('https://ms-votion.meilisearch.io');
    for (const origin of TRUSTED_EMBED_FRAME_SRC) {
      expect(csp).toContain(origin);
    }
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
});
