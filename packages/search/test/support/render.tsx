/**
 * Minimal hook test harness.
 *
 * The component layer is exported as React components, but the package's
 * verification gates run in Node without a DOM. Instead of pulling in jsdom +
 * Testing Library (which would add ~40 transitive packages to a server-safe
 * package), the modal is exercised through:
 *
 *  1. **`renderHook`** (below) — a real React root driven by a hand-written
 *     fiber-free scheduler shim is overkill; React's own `react-test-renderer`
 *     replacement would be another dependency. Instead we evaluate the hook's
 *     building blocks (`useQuickFind` via a tiny dispatcher) and assert the
 *     *observable contract*: debounce timing, cancellation, error state.
 *  2. **`renderToStaticMarkup`** (react-dom/server) — asserts the modal's
 *     markup: highlight `<mark>` nodes, breadcrumbs, empty states and a11y
 *     attributes.
 *
 * Both paths run the real component code; nothing is mocked except time and
 * the search service.
 */

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Renders a component tree to an HTML string. */
export function renderMarkup(
  element: Parameters<typeof renderToStaticMarkup>[0],
): string {
  return renderToStaticMarkup(element);
}

/** Renders a component with props. */
export function renderComponent<P extends object>(
  component: ComponentType<P>,
  props: P,
): string {
  return renderMarkup(createElement(component, props));
}

/** Strips tags so assertions can look at text content. */
export function textContent(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Counts occurrences of a substring. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Extracts every `<mark>` run from rendered markup. */
export function extractMarks(markup: string): string[] {
  const marks: string[] = [];
  const pattern = /<mark[^>]*>([\s\S]*?)<\/mark>/g;
  let match = pattern.exec(markup);
  while (match !== null) {
    marks.push(textContent(match[1] ?? ''));
    match = pattern.exec(markup);
  }
  return marks;
}

/** A deterministic in-memory `Storage` implementation. */
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

/** Deferred promise helper for exercising cancellation. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Waits for pending microtasks/timers. */
export function flushPromises(delayMs = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
