import { useCallback } from 'react';
import type { BackgroundColor, HighlightColor, TextColor } from '@votion/types';
import { clsx } from 'clsx';

export type FloatingToolbarFormat =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'underline'
  | 'code'
  | 'color'
  | 'highlight'
  | 'link';

export interface FloatingToolbarProps {
  visible: boolean;
  x: number;
  y: number;
  onFormat: (format: FloatingToolbarFormat, value?: string) => void;
  onClose: () => void;
}

const FORMAT_LABELS: Record<FloatingToolbarFormat, string> = {
  bold: 'Bold',
  italic: 'Italic',
  strikethrough: 'Strikethrough',
  underline: 'Underline',
  code: 'Code',
  color: 'Text color',
  highlight: 'Highlight',
  link: 'Link',
};

const COLOR_TOKENS: (TextColor | BackgroundColor)[] = [
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
];

/**
 * Bubble formatting menu that appears near a text selection. Emits
 * `onFormat` when an action is chosen; the caller applies the corresponding
 * `TextModifier` to the selected rich text segments.
 */
export function FloatingToolbar({
  visible,
  x,
  y,
  onFormat,
  onClose,
}: FloatingToolbarProps) {
  const handleFormat = useCallback(
    (format: FloatingToolbarFormat) => () => {
      onFormat(format);
    },
    [onFormat],
  );

  const handleLink = useCallback(() => {
    const url = window.prompt('Paste a link');
    if (url) {
      onFormat('link', url);
    }
  }, [onFormat]);

  const handleColor = useCallback(
    (color: TextColor | BackgroundColor) => () => {
      onFormat(
        color.endsWith('_background') ? 'highlight' : 'color',
        color as HighlightColor,
      );
    },
    [onFormat],
  );

  if (!visible) return null;

  return (
    <div
      className={clsx(
        'floating-toolbar',
        'fixed',
        'select-none',
        'opacity-90',
      )}
      style={{ left: x, top: y }}
    >
      {Object.entries(FORMAT_LABELS).map(([format, label]) => {
        const key = format as FloatingToolbarFormat;
        if (key === 'link') {
          return (
            <button
              type="button"
              key={key}
              className="toolbar-button"
              title={label}
              onClick={handleLink}
              aria-label={label}
            >
              🔗
            </button>
          );
        }
        return (
          <button
            type="button"
            key={key}
            className="toolbar-button"
            title={label}
            onClick={handleFormat(key)}
            aria-label={label}
          >
            {key === 'bold' ? 'B' : key === 'italic' ? 'I' : key === 'strikethrough' ? 'S̶' : key === 'underline' ? 'U̲' : key === 'code' ? '</>' : key === 'color' ? 'A' : 'H'}
          </button>
        );
      })}
      <button
        type="button"
        className="toolbar-button"
        title="Close"
        onClick={onClose}
        aria-label="Close formatting toolbar"
      >
        ✕
      </button>
    </div>
  );
}
