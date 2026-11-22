import katex from 'katex';
import {
  sanitizeKatexExpression,
  sanitizeKatexHtml,
} from '@votion/types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely renders a LaTeX / KaTeX expression to HTML with:
 * - Pre-render expression sanitization (`sanitizeKatexExpression`)
 * - Strict KaTeX options (`trust: false`, `maxExpand: 100`, `maxSize: 10`)
 * - Post-render HTML sanitization (`sanitizeKatexHtml`)
 */
export function renderSafeKatex(
  expression: string,
  displayMode: boolean,
): string {
  const safeExpression = sanitizeKatexExpression(expression);
  if (safeExpression.trim().length === 0) {
    return '';
  }
  try {
    const rendered = katex.renderToString(safeExpression, {
      throwOnError: false,
      displayMode,
      trust: false,
      strict: 'ignore',
      maxSize: 10,
      maxExpand: 100,
    });
    return sanitizeKatexHtml(rendered);
  } catch {
    return `<span class="katex-error">${escapeHtml(safeExpression)}</span>`;
  }
}
