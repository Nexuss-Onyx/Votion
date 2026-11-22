import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { CSSProperties } from 'react';
import {
  PopoverContent,
  PopoverTrigger,
  Root as PopoverRoot,
} from '@radix-ui/react-popover';
import { Search, List, type LucideIcon } from 'lucide-react';
import type { BlockType } from '@votion/types';

const CATALOG: ReadonlyArray<{
  type: BlockType;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { type: 'text', label: 'Text', description: 'Plain text paragraph', icon: List },
  { type: 'heading_1', label: 'Heading 1', description: 'Large heading', icon: List },
  { type: 'heading_2', label: 'Heading 2', description: 'Medium heading', icon: List },
  { type: 'heading_3', label: 'Heading 3', description: 'Small heading', icon: List },
  { type: 'to_do', label: 'To-do list', description: 'Checkbox item', icon: List },
  { type: 'bulleted_list_item', label: 'Bulleted list', description: 'List with bullets', icon: List },
  { type: 'numbered_list_item', label: 'Numbered list', description: 'Ordered list', icon: List },
  { type: 'toggle', label: 'Toggle', description: 'Collapsible section', icon: List },
  { type: 'quote', label: 'Quote', description: 'Styled quotation', icon: List },
  { type: 'callout', label: 'Callout', description: 'Emoji callout box', icon: List },
  { type: 'divider', label: 'Divider', description: 'Horizontal line', icon: List },
  { type: 'code', label: 'Code block', description: 'Syntax highlighted code', icon: List },
  { type: 'math', label: 'Math block', description: 'LaTeX equation', icon: List },
  { type: 'image', label: 'Image', description: 'Upload or embed an image', icon: List },
  { type: 'bookmark', label: 'Bookmark', description: 'Link preview card', icon: List },
];

export interface SlashMenuProps {
  /** Anchor position (popover escapes parent clipping via a portal). */
  x?: number;
  y?: number;
  /** 'insert' (default) inserts a new block; 'convert' converts the target block. */
  mode?: 'insert' | 'convert';
  onInsert: (type: BlockType) => void;
  onClose: () => void;
}

/**
 * `/` slash menu: filterable block catalog with arrow-key navigation,
 * Enter to insert and Escape to close. Rendered inside a Radix Popover so it
 * escapes parent overflow clipping and manages focus trapping.
 */
export function SlashMenu({
  x,
  y,
  mode = 'insert',
  onInsert,
  onClose,
}: SlashMenuProps) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () =>
      CATALOG.filter((item) => {
        const haystack = `${item.label} ${item.description}`.toLowerCase();
        return !query || haystack.includes(query.toLowerCase());
      }),
    [query],
  );

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // The popover opens on mount so the slash menu is immediately focusable.
  useEffect(() => {
    triggerRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        return; // Popover.Root reports the close via onOpenChange.
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((prev) => Math.min(prev + 1, items.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onInsert(items[highlighted]?.type ?? 'text');
        onClose();
        return;
      }
    },
    [items, highlighted, onInsert, onClose],
  );

  const handleSelect = useCallback(
    (type: BlockType) => {
      onInsert(type);
      onClose();
    },
    [onInsert, onClose],
  );

  const triggerStyle: CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    width: 0,
    height: 0,
    zIndex: 50,
  };

  return (
    <PopoverRoot modal={false} onOpenChange={(open) => !open && onClose()}>
      <PopoverTrigger asChild>
        <div ref={triggerRef} style={triggerStyle} />
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        className="slash-menu"
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.preventDefault()}
        style={{ position: 'fixed' }}
      >
        <div className="px-3 py-2">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${mode === 'convert' ? 'convert to' : 'insert'}…`}
            className="w-full text-sm border border-gray-200 rounded py-1.5 pl-8 pr-3 focus:ring-1 focus:ring-blue-400 outline-none"
            onKeyDown={handleKeyDown}
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-2 text-sm text-gray-500">No blocks found</div>
          ) : (
            items.map((item, index) => {
              const isSelected = index === highlighted;
              return (
                <div
                  key={item.type}
                  className={classNames(
                    'slash-menu-item',
                    isSelected ? 'slash-menu-item is-selected' : '',
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    handleSelect(item.type);
                  }}
                  role="option"
                  aria-selected={isSelected}
                  id={`slash-item-${index}`}
                >
                  <div className="flex w-6 items-center">
                    <item.icon className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="flex flex-col">
                    <div className="font-medium text-gray-900">{item.label}</div>
                    <div className="text-xs text-gray-500">{item.description}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {mode === 'convert' && (
          <div className="border-t border-gray-100 pt-2 px-3 text-xs text-gray-500">
            Converting target block
          </div>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

function classNames(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
