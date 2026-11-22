/**
 * Shared edge-security, XSS sanitization, and Content Security Policy helpers.
 *
 * Pure ES2022 (zero DOM or Node runtime globals required) so `@votion/editor`,
 * `@votion/web`, and `@votion/server` share identical defense-in-depth rules.
 */

import type {
  DateMetadata,
  HighlightColor,
  RichText,
  RichTextSegment,
  TextModifier,
} from './rich-text.js';

/** Maximum character length accepted for a single KaTeX expression. */
export const MAX_KATEX_EXPRESSION_LENGTH = 5000;

/** Maximum URL length accepted by URL sanitizers. */
export const MAX_URL_LENGTH = 4096;

/**
 * Trusted HTTPS hostnames allowed inside sandboxed embed iframes and CSP
 * `frame-src` directives (YouTube, Figma, GitHub, CodePen).
 */
export const TRUSTED_EMBED_HOSTS: readonly string[] = [
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'youtu.be',
  'www.figma.com',
  'figma.com',
  'embed.figma.com',
  'github.com',
  'www.github.com',
  'gist.github.com',
  'codepen.io',
  'www.codepen.io',
  'cdpn.io',
];

const TRUSTED_EMBED_HOST_SET: ReadonlySet<string> = new Set(TRUSTED_EMBED_HOSTS);

/** CSP `frame-src` origins derived from {@link TRUSTED_EMBED_HOSTS}. */
export const TRUSTED_EMBED_FRAME_SRC: readonly string[] = TRUSTED_EMBED_HOSTS.map(
  (host) => `https://${host}`,
);

/** Default Wasmer Edge HTTP and WebSocket `connect-src` patterns. */
export const WASMER_EDGE_CONNECT_SRC: readonly string[] = [
  "'self'",
  'https://*.wasmer.app',
  'wss://*.wasmer.app',
];

const ALLOWED_HIGHLIGHT_COLORS: ReadonlySet<string> = new Set<HighlightColor>([
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
  'gray_background',
  'brown_background',
  'orange_background',
  'yellow_background',
  'green_background',
  'blue_background',
  'purple_background',
  'pink_background',
  'red_background',
]);

/**
 * Strips ASCII control characters (`0x00`–`0x1F` and `0x7F`) in linear time
 * without control-character regexes.
 */
export function stripControlChars(
  input: string,
  preserveWhitespace = true,
): string {
  let result = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code === 0x7f) {
      continue;
    }
    if (code < 0x20) {
      if (preserveWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)) {
        result += input[i];
      }
      continue;
    }
    result += input[i];
  }
  return result;
}

interface ParsedHttpUrl {
  scheme: 'http:' | 'https:';
  hostname: string;
  port: string;
  pathAndQuery: string;
  hash: string;
  normalized: string;
}

const VALID_HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^\[[0-9a-f:]+\]$/i;

function parseHttpUrl(cleaned: string): ParsedHttpUrl | null {
  const match = /^(https?):\/\/([^/?#]*)([^#]*)(#.*)?$/i.exec(cleaned);
  if (!match) {
    return null;
  }
  const rawScheme = match[1];
  const authority = match[2];
  const pathAndQuery = match[3] ?? '';
  const hash = match[4] ?? '';

  if (!rawScheme || !authority) {
    return null;
  }
  // Reject userinfo (`user:pass@host`), backslashes, angle brackets, quotes, or spaces.
  if (/[@\\<>"'\s]/.test(authority) || /[<>"'\s]/.test(pathAndQuery) || /[<>"'\s]/.test(hash)) {
    return null;
  }

  let hostname = authority;
  let port = '';
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket === -1) {
      return null;
    }
    hostname = authority.slice(0, closingBracket + 1).toLowerCase();
    const rest = authority.slice(closingBracket + 1);
    if (rest.startsWith(':')) {
      port = rest.slice(1);
    } else if (rest.length > 0) {
      return null;
    }
  } else {
    const colonIndex = authority.indexOf(':');
    if (colonIndex !== -1) {
      hostname = authority.slice(0, colonIndex);
      port = authority.slice(colonIndex + 1);
    }
    hostname = hostname.toLowerCase().replace(/\.$/, '');
  }

  if (!hostname) {
    return null;
  }
  if (
    !VALID_HOSTNAME_RE.test(hostname) &&
    !IPV4_RE.test(hostname) &&
    !IPV6_RE.test(hostname)
  ) {
    return null;
  }

  if (port.length > 0) {
    if (!/^\d{1,5}$/.test(port)) {
      return null;
    }
    const numericPort = Number(port);
    if (numericPort < 1 || numericPort > 65535) {
      return null;
    }
  }

  const scheme = `${rawScheme.toLowerCase()}:` as 'http:' | 'https:';
  const defaultPort = (scheme === 'https:' && port === '443') || (scheme === 'http:' && port === '80');
  const normalizedPort = port && !defaultPort ? `:${port}` : '';
  const normalized = `${scheme}//${hostname}${normalizedPort}${pathAndQuery}${hash}`;

  return {
    scheme,
    hostname,
    port: defaultPort ? '' : port,
    pathAndQuery,
    hash,
    normalized,
  };
}

export interface SanitizeUrlOptions {
  /** Allow same-origin relative URLs starting with `/`, `?`, or `#` (default `true`). */
  allowRelative?: boolean;
  /** Allow `mailto:` links (default `true`). */
  allowMailto?: boolean;
  /** Require `https:` when absolute HTTP(S) URLs are supplied (default `false`). */
  requireHttps?: boolean;
}

/**
 * Validates and normalizes a hyperlink or media URL, rejecting dangerous
 * protocols (`javascript:`, `vbscript:`, `data:`, `file:`, `blob:`) and
 * protocol-relative redirects (`//evil.example`).
 */
export function sanitizeUrl(
  rawUrl: string,
  options: SanitizeUrlOptions = {},
): string | null {
  if (typeof rawUrl !== 'string') {
    return null;
  }
  const cleaned = stripControlChars(rawUrl, false).trim();
  if (cleaned.length === 0 || cleaned.length > MAX_URL_LENGTH) {
    return null;
  }

  const allowRelative = options.allowRelative ?? true;
  const allowMailto = options.allowMailto ?? true;
  const requireHttps = options.requireHttps ?? false;

  if (
    cleaned.startsWith('/') ||
    cleaned.startsWith('#') ||
    cleaned.startsWith('?')
  ) {
    if (!allowRelative) {
      return null;
    }
    // Block protocol-relative `//host` or `/\host` escapes.
    if (cleaned.startsWith('//') || cleaned.startsWith('/\\')) {
      return null;
    }
    if (/[<>"'\s]/.test(cleaned)) {
      return null;
    }
    return cleaned;
  }

  if (/^mailto:/i.test(cleaned)) {
    if (!allowMailto) {
      return null;
    }
    const target = cleaned.slice(7).trim();
    if (target.length === 0 || /[<>"'\s\\]/.test(target)) {
      return null;
    }
    return `mailto:${target}`;
  }

  const parsed = parseHttpUrl(cleaned);
  if (!parsed) {
    return null;
  }
  if (requireHttps && parsed.scheme !== 'https:') {
    return null;
  }
  return parsed.normalized;
}

/**
 * Validates an iframe embed URL against {@link TRUSTED_EMBED_HOSTS}.
 * Only HTTPS URLs targeting YouTube, Figma, GitHub, or CodePen are permitted.
 */
export function sanitizeEmbedUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string') {
    return null;
  }
  const cleaned = stripControlChars(rawUrl, false).trim();
  if (cleaned.length === 0 || cleaned.length > MAX_URL_LENGTH) {
    return null;
  }
  const parsed = parseHttpUrl(cleaned);
  if (!parsed || parsed.scheme !== 'https:' || parsed.port !== '') {
    return null;
  }
  if (!TRUSTED_EMBED_HOST_SET.has(parsed.hostname)) {
    return null;
  }
  return parsed.normalized;
}

/** Returns `true` when `rawUrl` is a valid HTTPS URL on a trusted embed host. */
export function isTrustedEmbedUrl(rawUrl: string): boolean {
  return sanitizeEmbedUrl(rawUrl) !== null;
}

/**
 * Strips executable HTML tags (`<script>`, `<iframe>`, `<svg>`, `<img>`, inline
 * `on*=` event handlers, and `javascript:`/`data:`/`vbscript:` attributes)
 * while preserving plain mathematical/code comparisons such as `a < b && c > d`.
 */
export function sanitizePlainText(
  input: string,
  options: { stripHtml?: boolean; maxLength?: number } = {},
): string {
  if (typeof input !== 'string') {
    return '';
  }
  const maxLength = options.maxLength ?? 100_000;
  let value = stripControlChars(input, true);
  if (value.length > maxLength) {
    value = value.slice(0, maxLength);
  }
  if (options.stripHtml === false) {
    return value;
  }

  // Strip paired executable containers first.
  value = value
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
    .replace(/<\s*iframe\b[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '')
    .replace(/<\s*object\b[^>]*>[\s\S]*?<\s*\/\s*object\s*>/gi, '');

  // Strip standalone dangerous HTML elements and any tag carrying event handlers
  // or dangerous URI schemes.
  value = value
    .replace(
      /<\s*\/?\s*(?:script|iframe|object|embed|svg|img|math|style|link|meta|base|form|input|button|textarea|select|body|html|head|applet|frame|frameset)\b[^>]*\/?>/gi,
      '',
    )
    .replace(
      /<[a-z][^>]*?(?:\bon[a-z]+\s*=|(?:href|src|xlink:href|action|formaction)\s*=\s*["']?\s*(?:javascript|vbscript|data)\s*:)[^>]*>/gi,
      '',
    );

  return value;
}

/**
 * Sanitizes a raw KaTeX / LaTeX expression before rendering:
 * - Enforces {@link MAX_KATEX_EXPRESSION_LENGTH}.
 * - Removes control characters and raw HTML tags (`<script>`, `<img onerror=...>`, etc.).
 * - Neutralizes dangerous LaTeX commands (`\href{javascript:...}`, `\url{javascript:...}`,
 *   `\htmlData`, `\htmlStyle`, `\htmlClass`, `\htmlId`, `\write18`, `\input`, `\include`).
 */
export function sanitizeKatexExpression(expression: string): string {
  if (typeof expression !== 'string') {
    return '';
  }
  let sanitized = stripControlChars(expression, true);
  if (sanitized.length > MAX_KATEX_EXPRESSION_LENGTH) {
    sanitized = sanitized.slice(0, MAX_KATEX_EXPRESSION_LENGTH);
  }

  // Remove embedded HTML XSS vectors while preserving mathematical `<` and `>`.
  sanitized = sanitizePlainText(sanitized, {
    stripHtml: true,
    maxLength: MAX_KATEX_EXPRESSION_LENGTH,
  });

  // Neutralize dangerous LaTeX URI and HTML-extension macros.
  sanitized = sanitized
    .replace(
      /\\href\s*\{\s*(?:javascript|vbscript|data|file)\s*:[^}]*\}\s*\{([^}]*)\}/gi,
      '$1',
    )
    .replace(/\\(?:href|url)\s*\{\s*(?:javascript|vbscript|data|file)\s*:[^}]*\}/gi, '')
    .replace(/\\html(?:Class|Id|Style|Data)\s*\{[^}]*\}/gi, '')
    .replace(/\\html(?:Class|Id|Style|Data)\b/gi, '')
    .replace(/\\(?:write18|input|include|openin|openout)\b(?:\s*\{[^}]*\})?/gi, '');

  return sanitized;
}

/**
 * Defense-in-depth post-sanitizer applied to HTML strings produced by
 * `katex.renderToString(...)` prior to `dangerouslySetInnerHTML`.
 */
export function sanitizeKatexHtml(renderedHtml: string): string {
  if (typeof renderedHtml !== 'string') {
    return '';
  }
  return stripControlChars(renderedHtml, true)
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*\/?\s*(?:script|iframe|object|embed|form|meta|link|base)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s+(?:href|src|xlink:href)\s*=\s*(?:"\s*(?:javascript|vbscript|data)\s*:[^"]*"|'\s*(?:javascript|vbscript|data)\s*:[^']*'|(?:\s*(?:javascript|vbscript|data)\s*:[^\s>]+))/gi,
      '',
    );
}

function sanitizeDateMetadata(meta: DateMetadata): DateMetadata {
  const startDate = sanitizePlainText(String(meta.start_date ?? ''), {
    maxLength: 64,
  }).trim();
  const cleaned: DateMetadata = {
    type: 'date',
    start_date: startDate,
  };
  if (typeof meta.end_date === 'string' && meta.end_date.length > 0) {
    cleaned.end_date = sanitizePlainText(meta.end_date, { maxLength: 64 }).trim();
  }
  if (typeof meta.time_zone === 'string' && meta.time_zone.length > 0) {
    cleaned.time_zone = sanitizePlainText(meta.time_zone, { maxLength: 64 }).trim();
  }
  if (typeof meta.include_time === 'boolean') {
    cleaned.include_time = meta.include_time;
  }
  return cleaned;
}

/**
 * Sanitizes a single `[text, modifiers?]` Rich Text segment, removing XSS HTML
 * tags, unsafe `javascript:`/`data:`/`vbscript:` hyperlinks, invalid highlight
 * classes, and malicious KaTeX macros.
 */
export function sanitizeRichTextSegment(segment: RichTextSegment): RichTextSegment {
  const rawText = Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '';
  const text = sanitizePlainText(rawText);
  const rawModifiers = Array.isArray(segment?.[1]) ? segment[1] : undefined;
  if (!rawModifiers || rawModifiers.length === 0) {
    return [text];
  }

  const sanitizedModifiers: TextModifier[] = [];
  for (const modifier of rawModifiers) {
    if (!Array.isArray(modifier) || modifier.length < 1) {
      continue;
    }
    const [tag, arg] = modifier;
    switch (tag) {
      case 'b':
      case 'i':
      case 's':
      case '_':
      case 'c':
        sanitizedModifiers.push([tag]);
        break;
      case 'h':
        if (typeof arg === 'string' && ALLOWED_HIGHLIGHT_COLORS.has(arg)) {
          sanitizedModifiers.push(['h', arg as HighlightColor]);
        }
        break;
      case 'a':
        if (typeof arg === 'string') {
          const safeLink = sanitizeUrl(arg, { allowRelative: true, allowMailto: true });
          if (safeLink) {
            sanitizedModifiers.push(['a', safeLink]);
          }
        }
        break;
      case 'e':
        if (typeof arg === 'string') {
          const safeEquation = sanitizeKatexExpression(arg);
          if (safeEquation.length > 0) {
            sanitizedModifiers.push(['e', safeEquation]);
          }
        }
        break;
      case 'u':
      case 'p':
        if (typeof arg === 'string') {
          const safeId = sanitizePlainText(arg, { maxLength: 128 }).trim();
          if (safeId.length > 0 && !/[<>"'\s]/.test(safeId)) {
            sanitizedModifiers.push([tag, safeId]);
          }
        }
        break;
      case 'd':
        if (typeof arg === 'object' && arg !== null && (arg as { type?: unknown }).type === 'date') {
          sanitizedModifiers.push(['d', sanitizeDateMetadata(arg as DateMetadata)]);
        }
        break;
      default:
        break;
    }
  }

  return sanitizedModifiers.length > 0 ? [text, sanitizedModifiers] : [text];
}

/** Sanitizes an entire Rich Text array, dropping malformed entries and XSS vectors. */
export function sanitizeRichText(richText: unknown): RichText {
  if (!Array.isArray(richText)) {
    return [];
  }
  const result: RichText = [];
  for (const item of richText) {
    if (!Array.isArray(item) || typeof item[0] !== 'string') {
      continue;
    }
    result.push(sanitizeRichTextSegment(item as RichTextSegment));
  }
  return result;
}

export interface ContentSecurityPolicyOptions {
  /** Whether Next.js inline hydration scripts are needed (`false` on pure API servers). */
  allowInlineScripts?: boolean;
  /** Allow `'unsafe-eval'` strictly during local development HMR (`false` in production). */
  allowDevEval?: boolean;
  /** Additional trusted `connect-src` origins (e.g. API URL, WS URL, Meilisearch, R2). */
  extraConnectSrc?: readonly string[];
  /** Include `upgrade-insecure-requests` directive (default `true` in production). */
  upgradeInsecureRequests?: boolean;
}

/**
 * Builds a strict Content-Security-Policy header string enforcing:
 * - Restricted `script-src`
 * - `frame-src` limited strictly to trusted embed providers (YouTube, Figma, GitHub, CodePen)
 * - `connect-src` restricted to `'self'`, Wasmer Edge (`https://*.wasmer.app`), and WebSocket gateways (`wss://*.wasmer.app`)
 */
export function buildContentSecurityPolicy(
  options: ContentSecurityPolicyOptions = {},
): string {
  const scriptSources = ["'self'"];
  if (options.allowInlineScripts) {
    scriptSources.push("'unsafe-inline'");
  }
  if (options.allowDevEval) {
    scriptSources.push("'unsafe-eval'");
  }

  const connectSet = new Set<string>(WASMER_EDGE_CONNECT_SRC);
  for (const entry of options.extraConnectSrc ?? []) {
    const trimmed = entry.trim();
    if (trimmed.length > 0 && !/[;\r\n]/.test(trimmed)) {
      connectSet.add(trimmed);
    }
  }

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' https:",
    `frame-src ${TRUSTED_EMBED_FRAME_SRC.join(' ')}`,
    `connect-src ${Array.from(connectSet).join(' ')}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];

  if (options.upgradeInsecureRequests) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}
