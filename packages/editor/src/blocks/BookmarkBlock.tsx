import type { Block, UUID } from '@votion/types';
import { richTextToPlainText } from '@votion/types';

export interface BookmarkBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
}

/**
 * Web bookmark block: a card rendering the source URL as a link preview.
 * (Real OpenGraph scraping is handled by the media processor worker.)
 */
export function BookmarkBlock({
  block,
}: BookmarkBlockProps): JSX.Element {
  const [source] = block.properties.source ?? [['']];
  const url = source[0];
  const title: string = block.properties.title
    ? richTextToPlainText(block.properties.title ?? [])
    : '';
  const plain = title || url;

  return (
    <div className="media-block my-2 flex flex-col rounded border border-gray-200 bg-white overflow-hidden">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-4 text-left"
      >
        <div className="text-sm font-medium text-gray-900 truncate">{plain}</div>
        <div className="text-xs text-gray-500 mt-1 truncate">{url}</div>
      </a>
    </div>
  );
}
