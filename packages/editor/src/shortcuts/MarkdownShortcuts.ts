/**
 * Markdown auto-formatting shortcuts.
 *
 * Converts plain-text line prefixes typed at the start of an empty block into
 * block-type conversions, mirroring Notion's markdown triggers:
 *
 *  - `# `  → heading_1   `## ` → heading_2   `### ` → heading_3
 *  - `- ` / `* ` → bulleted_list_item
 *  - `1. ` → numbered_list_item
 *  - `[] ` → to_do
 *  - `> `  → quote
 *  - `---` → divider
 *  - ` ``` ` → code
 */

export interface MarkdownTrigger {
  /** Block type the line converts into. */
  type: 'heading_1' | 'heading_2' | 'heading_3' | 'bulleted_list_item' | 'numbered_list_item' | 'to_do' | 'quote' | 'divider' | 'code';
  /** Anchored regular expression matched against the raw line. */
  pattern: RegExp;
}

/** Ordered catalog of markdown triggers. First match wins. */
export const MARKDOWN_TRIGS: MarkdownTrigger[] = [
  { type: 'heading_1', pattern: /^#\s(.+)$/ },
  { type: 'heading_2', pattern: /^##\s(.+)$/ },
  { type: 'heading_3', pattern: /^###\s(.+)$/ },
  { type: 'bulleted_list_item', pattern: /^[-*]\s(.+)$/ },
  { type: 'numbered_list_item', pattern: /^1\.\s(.+)$/ },
  { type: 'to_do', pattern: /^\[\]\s(.+)$/ },
  { type: 'quote', pattern: /^>\s(.+)$/ },
  { type: 'divider', pattern: /^---$/ },
  { type: 'code', pattern: /^```$/ },
];

export interface MarkdownConversion {
  type: MarkdownTrigger['type'];
  /** Body text carried into the converted block (empty for divider/code). */
  text: string;
}

/**
 * Parses a single line and returns the matching block conversion, or `null`
 * when no trigger matches.
 */
export function parseMarkdownLine(line: string): MarkdownConversion | null {
  for (const trig of MARKDOWN_TRIGS) {
    const match = line.match(trig.pattern);
    if (match) {
      const text =
        trig.pattern.source.includes('(.+)') && match[1] !== undefined
          ? match[1]
          : '';
      return { type: trig.type, text };
    }
  }
  return null;
}
