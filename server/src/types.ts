export type DrawEventType = 'stroke_start' | 'stroke_move' | 'stroke_end' | 'clear';

export interface Point {
  x: number;
  y: number;
}

export interface DrawEvent {
  type: DrawEventType;
  strokeId: string;
  point?: Point;
  color?: string;
  lineWidth?: number;
  userId: string;
}

/** What the client sends — server stamps userId and seq */
export type DrawEventPayload = Omit<DrawEvent, 'userId'>;

/** What gets stored in the log and broadcast to peers */
export interface DrawAction extends DrawEvent {
  seq: number;
}

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
