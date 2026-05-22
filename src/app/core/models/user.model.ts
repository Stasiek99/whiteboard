export interface WhiteboardUser {
  id: string;
  name: string;
  color: string;
}

/** Normalized cursor position (x/y in 0.0–1.0 relative to canvas logical size). */
export interface CursorPosition {
  userId: string;
  x: number;
  y: number;
}
