/**
 * Small formatting helpers used by the Quick Find result rows.
 */

/** Formats an epoch-ms timestamp as a short relative label ("2h ago"). */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }
  const deltaSeconds = Math.floor((now - timestamp) / 1000);
  if (deltaSeconds < 0) {
    return 'just now';
  }
  if (deltaSeconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  return `${Math.floor(days / 365)}y ago`;
}

/** Human label for a block type, used as the result row's type badge. */
export function formatBlockTypeLabel(type: string): string {
  switch (type) {
    case 'page':
      return 'Page';
    case 'collection_view':
      return 'Database';
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return 'Heading';
    case 'to_do':
      return 'To-do';
    case 'bulleted_list_item':
    case 'numbered_list_item':
      return 'List';
    case 'code':
      return 'Code';
    case 'quote':
      return 'Quote';
    case 'callout':
      return 'Callout';
    case 'table':
      return 'Table';
    case 'toggle':
      return 'Toggle';
    case 'math':
      return 'Equation';
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'pdf':
    case 'bookmark':
    case 'embed':
      return 'Media';
    case 'text':
      return 'Text';
    default:
      return type;
  }
}

/** Splits a breadcrumb string into readable crumbs. */
export function splitBreadcrumb(
  breadcrumb: string | undefined,
  separator = ' / ',
): string[] {
  if (!breadcrumb) {
    return [];
  }
  return breadcrumb
    .split(separator)
    .map((crumb) => crumb.trim())
    .filter((crumb) => crumb.length > 0);
}
