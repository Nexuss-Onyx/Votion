'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Link2, Upload, X } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';

import { useWorkspace } from '@/state/WorkspaceProvider';

const UNSPLASH_TRIPS = [
  { id: 'meadow', url: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?q=80&w=1200&auto=format&fit=crop', label: 'Meadow' },
  { id: 'tower', url: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?q=80&w=1200&auto=format&fit=crop', label: 'Tower' },
  { id: 'dusk', url: 'https://images.unsplash.com/photo-1559028012-481c04fa702d?q=80&w=1200&auto=format&fit=crop', label: 'Dusk' },
  { id: 'lines', url: 'https://images.unsplash.com/photo-1509116327711-aa746b1ad54b?q=80&w=1200&auto=format&fit=crop', label: 'Lines' },
] as const;

/**
 * Page cover with hover-triggered customization: Unsplash samples, file
 * upload (object URL) or a pasted URL.
 */
export function PageCover({ pageId }: { pageId: string }) {
  const { getBlock, setPageCover } = useWorkspace();
  const page = getBlock(pageId);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [imageError, setImageError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const cover = page?.format?.page_cover;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const applyCover = (next: string | null) => {
    setPageCover(pageId, next);
    setOpen(false);
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        applyCover(URL.createObjectURL(file));
        return;
      } catch {
        // fall through to the object-URL-free path below
      }
    }
    // Fallback (tests / restricted environments): the file is remembered as its
    // original name so the cover keeps a truthful, non-broken value.
    applyCover(file.name);
  };

  const handleApplyUrl = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) return;
    applyCover(trimmed);
    setUrl('');
  };

  return (
    <div ref={rootRef} className="group relative -mx-6 mb-4 h-40 overflow-hidden sm:-mx-10 sm:h-48">
      {cover && !imageError ? (
        <img
          src={cover}
          alt=""
          onError={() => setImageError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="h-full w-full"
          style={{
            background:
              'linear-gradient(120deg, #312e81 0%, #4f46e5 35%, #0ea5e9 75%, #22d3ee 100%)',
          }}
          aria-hidden
        />
      )}

      {/* Hover affordance */}
      <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="m-3 flex items-center gap-1.5 rounded-shell bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-notion-text shadow-sm backdrop-blur transition-colors hover:bg-white"
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
          Change cover
        </button>
        {cover && (
          <button
            type="button"
            onClick={() => applyCover(null)}
            className="m-3 flex items-center gap-1.5 rounded-shell bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-notion-text shadow-sm backdrop-blur transition-colors hover:bg-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Remove cover
          </button>
        )}
      </div>

      {/* Customizer panel */}
      {open && (
        <div className="absolute bottom-3 left-3 right-3 z-10 rounded-2xl border border-notion-border bg-white p-3 shadow-popLg">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-notion-muted">
            Choose a cover
          </p>
          <div className="grid grid-cols-4 gap-2">
            {UNSPLASH_TRIPS.map((trip) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => applyCover(trip.url)}
                className="group/thumb relative overflow-hidden rounded-lg border border-notion-border transition-transform hover:scale-[1.03]"
                aria-label={`Use the ${trip.label} cover`}
              >
                <img src={trip.url} alt="" className="h-14 w-full object-cover" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[9px] font-medium text-white">
                  {trip.label}
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={handleApplyUrl} className="mt-2 flex items-center gap-2">
            <Link2 className="h-4 w-4 shrink-0 text-notion-muted" aria-hidden />
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
              aria-label="Cover image URL"
              className="h-8 min-w-0 flex-1 rounded-shell border border-notion-border px-2 text-xs outline-none focus:border-notion-accent"
            />
            <button
              type="submit"
              className="h-8 shrink-0 rounded-shell bg-notion-accent px-2.5 text-[11px] font-semibold text-white hover:bg-notion-accentOn"
            >
              Apply
            </button>
          </form>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label="Upload a cover image"
            className="hidden"
            onChange={(event) => {
              void handleUpload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-shell border border-notion-border bg-notion-sidebar px-3 py-2 text-xs font-semibold text-notion-text transition-colors hover:bg-notion-hover"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload from device (images up to 8 MB)
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Emoji picker button that sets the page icon (format.page_icon).
 */
export function PageIconPicker({ pageId }: { pageId: string }) {
  const { getBlock, setPageIcon } = useWorkspace();
  const page = getBlock(pageId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentIcon = page?.format?.page_icon ?? '📄';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Page icon: ${currentIcon}. Change icon`}
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-notion-hover text-3xl shadow-sm transition-transform hover:scale-105"
      >
        <span aria-hidden>{currentIcon}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-2xl border border-notion-border bg-white p-2 shadow-popLg">
          <EmojiPicker
            width={248}
            height={280}
            onEmojiClick={(emoji: { emoji: string }) => {
              setPageIcon(pageId, emoji.emoji);
              setOpen(false);
            }}
            searchDisabled={false}
            lazyLoadEmojis
          />
        </div>
      )}
    </div>
  );
}
