/**
 * Dispatches a collection view record to the matching projection component.
 */

import type { JSX } from 'react';
import type { DatabaseViewProps } from './types.js';
import { TableView } from './TableView/TableView.js';
import { BoardView } from './BoardView/BoardView.js';
import { CalendarView } from './CalendarView/CalendarView.js';
import { TimelineView } from './TimelineView/TimelineView.js';
import { GalleryView } from './GalleryView/GalleryView.js';
import { ListView } from './ListView/ListView.js';

/** Renders the projection selected by `view.type`. */
export function ViewRenderer(props: DatabaseViewProps): JSX.Element {
  switch (props.view.type) {
    case 'table':
      return <TableView {...props} />;
    case 'board':
      return <BoardView {...props} />;
    case 'calendar':
      return <CalendarView {...props} />;
    case 'timeline':
      return <TimelineView {...props} />;
    case 'gallery':
      return <GalleryView {...props} />;
    case 'list':
      return <ListView {...props} />;
    default: {
      const exhaustive: never = props.view.type;
      throw new Error(`Unsupported view type: ${String(exhaustive)}`);
    }
  }
}
