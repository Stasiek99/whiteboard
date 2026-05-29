/** Wire types shared between client and server for Socket.IO communication. */

export type DrawEventType = 'stroke_start' | 'stroke_move' | 'stroke_end' | 'clear';

export interface WirePoint {
  x: number;
  y: number;
}

export interface DrawEvent {
  type: DrawEventType;
  strokeId: string;
  point?: WirePoint;
  color?: string;
  lineWidth?: number;
  userId: string;
}

/** Payload the client sends — server stamps userId and seq. */
export type DrawEventPayload = Omit<DrawEvent, 'userId'>;

/** Broadcast-ready action with server-assigned sequence number. */
export interface WireDrawAction extends DrawEvent {
  seq: number;
}

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
