/**
 * JSON envelope send/receive helpers shared by the gateway subsystems.
 */

import type { WebSocket } from 'ws';
import { WebSocket as WsWebSocket } from 'ws';
import type { SocketErrorEnvelope, ServerSocketMessage } from '@votion/types';

/** Serializes and sends an envelope; returns false when the socket is not open. */
export function sendEnvelope(socket: WebSocket, envelope: ServerSocketMessage): boolean {
  if (socket.readyState !== WsWebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(envelope));
  return true;
}

/** Sends a recoverable error envelope to a single socket. */
export function sendSocketError(socket: WebSocket, code: string, message: string): boolean {
  const envelope: SocketErrorEnvelope = { type: 'error', code, message };
  return sendEnvelope(socket, envelope);
}
