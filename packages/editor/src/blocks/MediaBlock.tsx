import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Block,
  type RichText,
  type UUID,
  sanitizeEmbedUrl,
  sanitizeUrl,
} from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import type { BlockEditorActions } from '../lib/editor.js';
import { BookmarkBlock } from './BookmarkBlock.js';

export interface MediaBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

const [IMAGE, VIDEO, AUDIO, FILE, BOOKMARK, EMBED] = [
  'image',
  'video',
  'audio',
  'file',
  'bookmark',
  'embed',
] as const;

function sourceOf(block: Block): string {
  const [source] = block.properties.source ?? [['']];
  return source[0];
}

function safeMediaUrl(block: Block): string | null {
  return sanitizeUrl(sourceOf(block), {
    allowRelative: true,
    allowMailto: false,
  });
}

/** Image block with width resize handles, stored in `format.block_width`. */
function ImageMedia({
  block,
  editor,
}: {
  block: Block;
  editor: BlockEditorActions;
}) {
  const url = safeMediaUrl(block);
  const [width, setWidth] = useState(() => {
    const stored = (block.format.block_width as number | undefined) ?? 100;
    return Math.max(20, Math.min(200, stored));
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const isResizing = useRef(false);
  const startWidth = useRef(0);
  const startX = useRef(0);

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    isResizing.current = true;
    startWidth.current = widthRef.current;
    startX.current = event.clientX;
  }, []);

  useEffect(() => {
    if (!isResizing.current) return;
    const handleMove = (event: MouseEvent) => {
      const next = Math.max(
        20,
        Math.min(200, startWidth.current + (event.clientX - startX.current) / 2),
      );
      setWidth(next);
      editor.patchBlock(block.id, {
        format: { ...block.format, block_width: next },
      });
    };
    const handleUp = () => {
      isResizing.current = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [block.id, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const caption: RichText = block.properties.caption ?? [];

  if (!url) {
    return (
      <div className="media-block my-2 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Invalid or blocked image source URL.
      </div>
    );
  }

  return (
    <figure className="media-block my-2 text-center relative" style={{ width: `${width}%` }}>
      <img
        src={url}
        alt=""
        style={{ width: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
        className="rounded border border-gray-100"
      />
      {caption.length > 0 && (
        <figcaption className="text-xs text-gray-500 mt-1">
          <RichTextRenderer richText={caption} />
        </figcaption>
      )}
      <div
        className="absolute -bottom-1.5 right-0 w-3 h-3 rounded border border-gray-400 bg-white cursor-se-resize"
        onMouseDown={handleResizeStart}
      />
    </figure>
  );
}

/** Video block with native player controls. */
function VideoMedia({ block }: { block: Block }) {
  const url = safeMediaUrl(block);
  if (!url) {
    return (
      <div className="media-block my-2 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Invalid or blocked video source URL.
      </div>
    );
  }
  return (
    <div className="media-block my-2">
      <video src={url} controls className="rounded border border-gray-100 w-full" />
    </div>
  );
}

/** Audio block with native player controls. */
function AudioMedia({ block }: { block: Block }) {
  const url = safeMediaUrl(block);
  if (!url) {
    return (
      <div className="media-block my-2 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Invalid or blocked audio source URL.
      </div>
    );
  }
  return (
    <div className="media-block my-2">
      <audio src={url} controls className="w-full" />
    </div>
  );
}

/** File attachment block with a sanitized download link. */
function FileMedia({ block }: { block: Block }) {
  const url = safeMediaUrl(block);
  if (!url) {
    return (
      <div className="media-block my-2 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Invalid or blocked attachment URL.
      </div>
    );
  }
  return (
    <div className="media-block my-2 flex items-center gap-2 rounded border border-gray-200 bg-gray-50 p-3">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
        📎 {url.split('/').pop() ?? url}
      </a>
    </div>
  );
}

/**
 * Sandboxed embed block restricted strictly to trusted HTTPS providers
 * (YouTube, Figma, GitHub, CodePen).
 */
function EmbedMedia({ block }: { block: Block }) {
  const safeUrl = sanitizeEmbedUrl(sourceOf(block));
  if (!safeUrl) {
    return (
      <div
        data-testid="blocked-embed"
        role="alert"
        className="media-block my-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
      >
        Embed blocked: only HTTPS URLs from trusted providers (YouTube, Figma, GitHub, CodePen) are permitted.
      </div>
    );
  }
  return (
    <div className="media-block my-2 aspect-video rounded border border-gray-200 overflow-hidden">
      <iframe
        src={safeUrl}
        title="Embed"
        className="w-full h-full"
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    </div>
  );
}

/**
 * Media block renderer: image, video, audio, file, bookmark and embed.
 * Images carry width resize handles; all media store their source URL in
 * `properties.source`.
 */
export function MediaBlock({
  block,
  editor,
}: MediaBlockProps): JSX.Element {
  switch (block.type) {
    case IMAGE:
      return <ImageMedia block={block} editor={editor} />;
    case VIDEO:
      return <VideoMedia block={block} />;
    case AUDIO:
      return <AudioMedia block={block} />;
    case FILE:
      return <FileMedia block={block} />;
    case BOOKMARK:
      return <BookmarkBlock block={block} />;
    case EMBED:
      return <EmbedMedia block={block} />;
    default:
      return <></>;
  }
}
