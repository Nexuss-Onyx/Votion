import type {
  BackgroundColor,
  HighlightColor,
  RichText,
  RichTextSegment,
  TextColor,
  TextModifier,
} from '@votion/types';
import katex from 'katex';
import { clsx } from 'clsx';

const TEXT_COLOR_CLASSES: Record<TextColor, string> = {
  default: 'color-default',
  gray: 'color-gray',
  brown: 'color-brown',
  orange: 'color-orange',
  yellow: 'color-yellow',
  green: 'color-green',
  blue: 'color-blue',
  purple: 'color-purple',
  pink: 'color-pink',
  red: 'color-red',
};

const HIGHLIGHT_CLASSES: Record<BackgroundColor, string> = {
  gray_background: 'highlight-gray_background',
  brown_background: 'highlight-brown_background',
  orange_background: 'highlight-orange_background',
  yellow_background: 'highlight-yellow_background',
  green_background: 'highlight-green_background',
  blue_background: 'highlight-blue_background',
  purple_background: 'highlight-purple_background',
  pink_background: 'highlight-pink_background',
  red_background: 'highlight-red_background',
};

export interface RichTextRendererProps {
  richText: RichText;
  /** Optional CSS class applied to every segment wrapper. */
  className?: string;
}

/** Renders a single `[text, modifiers]` rich text segment. */
export function renderRichTextSegment(
  segment: RichTextSegment,
  index: number,
): JSX.Element {
  const [content, modifiers = []] = segment;
  const classes: string[] = [];
  let link: string | undefined;
  let equation: string | undefined;
  let renderedContent: string | JSX.Element = content;

  for (const modifier of modifiers) {
    const [tag, argument] = modifier;
    switch (tag) {
      case 'b':
        classes.push('is-bold');
        break;
      case 'i':
        classes.push('is-italic');
        break;
      case 's':
        classes.push('is-strikethrough');
        break;
      case '_':
        classes.push('is-underline');
        break;
      case 'c':
        classes.push('is-code');
        break;
      case 'h': {
        const color = argument as HighlightColor;
        classes.push(
          color.endsWith('_background')
            ? (HIGHLIGHT_CLASSES[color as BackgroundColor] ?? '')
            : (TEXT_COLOR_CLASSES[color as TextColor] ?? ''),
        );
        break;
      }
      case 'a':
        link = argument as string;
        break;
      case 'e':
        equation = argument as string;
        break;
      case 'd': {
        const metadata = argument as { start_date: string; end_date?: string };
        renderedContent = metadata.end_date
          ? `${metadata.start_date} → ${metadata.end_date}`
          : metadata.start_date;
        break;
      }
      case 'u':
        renderedContent = '@user';
        classes.push('notion-mention');
        break;
      case 'p':
        renderedContent = '@page';
        classes.push('notion-mention');
        break;
      default:
        break;
    }
  }

  const segmentClasses = clsx(
    'rich-text-segment',
    ...classes,
    link ? 'rich-text-link' : '',
    equation ? 'rich-text-equation' : '',
  );

  if (equation) {
    return (
      <a
        className={segmentClasses}
        key={`segment-${index}`}
        href={link ?? undefined}
        target={link ? '_blank' : undefined}
        rel={link ? 'noopener noreferrer' : undefined}
      >
        <span
          className="inline-equation"
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(equation, {
              throwOnError: false,
              displayMode: false,
            }),
          }}
        />
      </a>
    );
  }

  return (
    <span
      className={segmentClasses}
      key={`segment-${index}`}
    >
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer">
          {renderedContent}
        </a>
      ) : (
        renderedContent
      )}
    </span>
  );
}

/**
 * Renders a `[string, TextModifier[]][]` rich text value into inline DOM
 * nodes supporting bold, italic, strikethrough, underline, code, color /
 * highlight, links, inline equations and mentions.
 */
export function RichTextRenderer({
  richText,
  className,
}: RichTextRendererProps): JSX.Element {
  return (
    <span className={clsx('rich-text', className)}>
      {richText.map((segment, index) => renderRichTextSegment(segment, index))}
    </span>
  );
}
