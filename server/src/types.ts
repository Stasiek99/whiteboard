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

export interface ServerToClientEvents {
  draw: (event: DrawEvent) => void;
  user_joined: (userId: string) => void;
  user_left: (userId: string) => void;
}

export interface ClientToServerEvents {
  draw: (event: DrawEvent) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
}
