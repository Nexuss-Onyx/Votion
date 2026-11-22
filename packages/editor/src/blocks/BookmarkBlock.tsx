import {
  type Block,
  type UUID,
  richTextToPlainText,
  sanitizePlainText,
  sanitizeUrl,
} from '@votion/types';

export interface BookmarkBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
}

/**
 * Web bookmark block: a card rendering the sanitized source URL as a link preview.
 * (Real OpenGraph scraping is handled by the media processor worker.)
 */
export function BookmarkBlock({
  block,
}: BookmarkBlockProps): JSX.Element {
  const [source] = block.properties.source ?? [['']];
  const rawUrl = source[0];
  const safeUrl = sanitizeUrl(rawUrl, { allowRelative: false, allowMailto: false });
  const title: string = block.properties.title
    ? sanitizePlainText(richTextToPlainText(block.properties.title ?? []))
    : '';
  const plain = title || safeUrl || 'Invalid bookmark URL';

  if (!safeUrl) {
    return (
      <div className="media-block my-2 flex flex-col rounded border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
        {plain}
      </div>
    );
  }

  return (
    <div className="media-block my-2 flex flex-col rounded border border-gray-200 bg-white overflow-hidden">
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-4 text-left"
      >
        <div className="text-sm font-medium text-gray-900 truncate">{plain}</div>
        <div className="text-xs text-gray-500 mt-1 truncate">{safeUrl}</div>
      </a>
    </div>
  );
}
