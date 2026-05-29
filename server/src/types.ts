export interface Point {
  x: number;
  y: number;
}

export interface WireStrokePayload {
  type: 'stroke';
  strokeId: string;
  points: Point[];
  color: string;
  lineWidth: number;
}

export interface WireErasePayload {
  type: 'erase';
  strokeId: string;
  points: Point[];
  lineWidth: number;
}

export interface WireShapePayload {
  type: 'shape';
  strokeId: string;
  shape: 'rect' | 'ellipse';
  from: Point;
  to: Point;
  color: string;
  lineWidth: number;
  filled: boolean;
}

export interface WireClearPayload {
  type: 'clear';
  strokeId: string;
}

/** What the client sends — server stamps userId and seq */
export type DrawEventPayload =
  | WireStrokePayload
  | WireErasePayload
  | WireShapePayload
  | WireClearPayload;

/** What gets stored in the log and broadcast to peers */
export type DrawAction = DrawEventPayload & { userId: string; seq: number };

export interface DrawActionAck {
  seq: number;
}

export interface BoardState {
  seq: number;
  log: DrawAction[];
}

export interface CursorEvent {
  x: number;
  y: number;
  userId: string;
}

/** What the client sends — server stamps userId */
export type CursorPayload = Omit<CursorEvent, 'userId'>;

export interface ServerToClientEvents {
  'draw:action': (action: DrawAction) => void;
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

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  boardId: string;
}
