/** Wire types shared between client and server for Socket.IO communication. */

export interface WirePoint {
  x: number;
  y: number;
}

export interface WireStrokePayload {
  type: 'stroke';
  strokeId: string;
  points: WirePoint[];
  color: string;
  lineWidth: number;
}

export interface WireErasePayload {
  type: 'erase';
  strokeId: string;
  points: WirePoint[];
  lineWidth: number;
}

export interface WireShapePayload {
  type: 'shape';
  strokeId: string;
  shape: 'rect' | 'ellipse';
  from: WirePoint;
  to: WirePoint;
  color: string;
  lineWidth: number;
  filled: boolean;
}

export interface WireClearPayload {
  type: 'clear';
  strokeId: string;
}

/** Payload the client sends — server stamps userId and seq. */
export type DrawEventPayload =
  | WireStrokePayload
  | WireErasePayload
  | WireShapePayload
  | WireClearPayload;

/** Broadcast-ready action with server-assigned userId and sequence number. */
export type WireDrawAction = DrawEventPayload & { userId: string; seq: number };

export interface DrawActionAck {
  seq: number;
}

export interface BoardState {
  seq: number;
  log: WireDrawAction[];
}

export interface CursorEvent {
  x: number;
  y: number;
  userId: string;
}

/** Payload the client sends — server stamps userId. */
export type CursorPayload = Omit<CursorEvent, 'userId'>;

export interface ServerToClientEvents {
  'draw:action': (action: WireDrawAction) => void;
  'draw:cursor': (event: CursorEvent) => void;
  'board:state': (state: BoardState) => void;
  'user:joined': (userId: string) => void;
  'user:left': (userId: string) => void;
}

export interface ClientToServerEvents {
  'draw:action': (payload: DrawEventPayload, ack: (res: DrawActionAck) => void) => void;
  'draw:cursor': (payload: CursorPayload) => void;
  'user:join': () => void;
}
