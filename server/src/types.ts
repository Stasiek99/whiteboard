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

export interface ServerToClientEvents {
  'draw:action': (action: DrawAction) => void;
  user_joined: (userId: string) => void;
  user_left: (userId: string) => void;
}

export interface ClientToServerEvents {
  'draw:action': (payload: DrawEventPayload, ack: (res: DrawActionAck) => void) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  boardId: string;
}
