'use client';

import { useWorkspace } from '@/state/WorkspaceProvider';

/**
 * Live presence badges — avatars for the collaborators currently connected to
 * the page, with a green presence dot. Overflow is collapsed into a +N chip.
 */
export function PresenceAvatars() {
  const { peers } = useWorkspace();

  if (peers.length === 0) return null;

  const shown = peers.slice(0, 4);
  const overflow = peers.length - shown.length;

  return (
    <div
      role="status"
      aria-label={`${peers.length} collaborator${peers.length === 1 ? '' : 's'} online`}
      className="flex items-center"
    >
      <div className="flex -space-x-2">
        {shown.map((peer) => (
          <span
            key={peer.id}
            title={`${peer.name}${peer.active ? ' — active now' : ' — idle'}`}
            className="relative flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white"
            style={{ backgroundColor: peer.color }}
          >
            {peer.initials}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                peer.active ? 'bg-green-400' : 'bg-amber-300'
              }`}
              aria-hidden
            />
            <span className="sr-only">{peer.name}</span>
          </span>
        ))}
        {overflow > 0 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-notion-active text-[10px] font-semibold text-notion-text ring-2 ring-white">
            +{overflow}
          </span>
        )}
      </div>
      <span className="ml-2 hidden text-[11px] font-medium text-notion-muted sm:inline">
        {peers.length} online
      </span>
    </div>
  );
}
