/**
 * Global keyboard shortcuts for the Quick Find modal.
 *
 * `Cmd+K` on macOS / `Ctrl+K` on Windows & Linux toggles the modal; `Escape`
 * closes it. The listener is attached to `window` (not the input) so the modal
 * can be opened from anywhere — including inside a focused editor.
 *
 * Guards:
 *  - text inputs are *not* hijacked for `Escape` unless the modal owns focus;
 *  - `Cmd+K` inside the browser's own chrome is unaffected (we only see the
 *    window listener) but `preventDefault()` runs so the page never triggers
 *    its own search box.
 */

import { useEffect, useRef } from 'react';

/** Handler invoked when the shortcut fires. */
export interface GlobalShortcutHandlers {
  /** `Cmd+K` / `Ctrl+K` (also `Cmd+P` / `Ctrl+P`, Notion's alternative). */
  onToggle?: () => void;
  /** `Escape`, when the modal is open. */
  onEscape?: () => void;
  /** Whether the modal is open (gates the `Escape` handler). */
  open?: boolean;
  /** Disable the listener entirely. */
  enabled?: boolean;
  /** The window-like object to bind to (tests / iframes). */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/** Structural keyboard event, so the helper is testable without the DOM. */
export interface ShortcutKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  defaultPrevented?: boolean;
}

/**
 * Pure predicate: does this event request the Quick Find toggle?
 *
 * `Cmd+K`, `Ctrl+K`, `Cmd+P` and `Ctrl+P` qualify; `Alt`/`Shift` combinations
 * are left to the browser (they belong to other shortcuts).
 */
export function isQuickFindShortcut(event: ShortcutKeyEvent): boolean {
  const key = (event.key ?? '').toLowerCase();
  const modifier = event.metaKey === true || event.ctrlKey === true;
  if (!modifier || event.altKey === true) {
    return false;
  }
  return key === 'k' || key === 'p';
}

/** `true` when the event is a plain `Escape` press. */
export function isEscapeKey(event: ShortcutKeyEvent): boolean {
  return (
    (event.key ?? '') === 'Escape' &&
    event.metaKey !== true &&
    event.ctrlKey !== true
  );
}

/** Detects the macOS platform for the `⌘K` / `Ctrl K` hint label. */
export function isMacPlatform(): boolean {
  const nav = (
    globalThis as { navigator?: { platform?: string; userAgent?: string } }
  ).navigator;
  if (!nav) {
    return false;
  }
  const source = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(source);
}

/** Label for the shortcut hint ("⌘K" or "Ctrl K"). */
export function quickFindShortcutLabel(mac: boolean = isMacPlatform()): string {
  return mac ? '⌘K' : 'Ctrl K';
}

/** React hook wrapper around {@link isQuickFindShortcut}. */
export function useGlobalShortcut(handlers: GlobalShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (handlers.enabled === false) {
      return undefined;
    }
    const target:
      Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined =
      handlers.target ?? (globalThis as { window?: Window }).window;
    if (!target) {
      return undefined;
    }

    const listener = (rawEvent: Event): void => {
      const event = rawEvent as unknown as ShortcutKeyEvent;
      const current = handlersRef.current;

      if (isQuickFindShortcut(event)) {
        event.preventDefault?.();
        current.onToggle?.();
        return;
      }
      if (current.open !== false && isEscapeKey(event)) {
        event.preventDefault?.();
        current.onEscape?.();
      }
    };

    target.addEventListener('keydown', listener);
    return () => {
      target.removeEventListener('keydown', listener);
    };
  }, [handlers.enabled, handlers.target]);
}
