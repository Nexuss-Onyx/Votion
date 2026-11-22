/**
 * Shell-level domain types for the Votion web application.
 *
 * The record model (pages, blocks, collections) lives in `@votion/types`; the
 * shapes below carry the workspace chrome that is owned by the shell — users,
 * favorites, teamspaces, presence, comments and notifications.
 */

import type { UUID } from '@votion/types';

/** A workspace (top-level container for pages, like a Linear team workspace or a Notion workspace). */
export interface Workspace {
  id: UUID;
  name: string;
  icon: string;
  color: string;
}

/** A person — used for members, comment authors, invitee rows and presence. */
export interface Profile {
  id: UUID;
  name: string;
  initials: string;
  color: string;
  email?: string;
}

/** A teamspace — a named department grouping of pages. */
export interface Teamspace {
  id: UUID;
  name: string;
  icon: string;
  color: string;
  pageIds: UUID[];
}

/** Live collaborator badge rendered in the top bar. */
export interface PresencePeer {
  id: UUID;
  name: string;
  initials: string;
  color: string;
  /** Whether the peer is actively editing the page right now. */
  active: boolean;
}

/** A single reply inside a discussion thread or an inline comment. */
export interface CommentReply {
  id: UUID;
  author: Profile;
  body: string;
  createdAt: number;
}

/** Threaded comment shown in the page-level Discussion section. */
export interface DiscussionThread {
  id: UUID;
  pageId: UUID;
  author: Profile;
  body: string;
  resolved: boolean;
  reactions: Record<string, number>;
  replies: CommentReply[];
  createdAt: number;
}

/** Inline comment anchored to a highlighted span of a page block. */
export interface InlineComment {
  id: UUID;
  pageId: UUID;
  blockId: UUID;
  /** Substring of the block's rich text the comment is anchored to. */
  anchor: string;
  author: Profile;
  body: string;
  resolved: boolean;
  reactions: Record<string, number>;
  replies: CommentReply[];
  createdAt: number;
}

/** Notification inbox row. */
export interface ShellNotification {
  id: UUID;
  kind: 'mention' | 'reply' | 'invite';
  title: string;
  body: string;
  pageId?: UUID;
  authorName: string;
  authorColor: string;
  unread: boolean;
  createdAt: number;
}

/** A page shared publicly with an invite link. */
export interface SharedPage {
  pageId: UUID;
  url: string;
  public: boolean;
  members: Array<{ profile: Profile; role: 'viewer' | 'commenter' | 'editor' }>;
}
