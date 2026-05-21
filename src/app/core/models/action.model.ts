/** Normalized canvas coordinate (0.0–1.0 relative to canvas logical size). */
export interface Point {
  x: number;
  y: number;
}

export interface StrokeAction {
  type: 'STROKE';
  id: string;
  points: Point[];
  color: string;
  width: number;
}

export interface EraseAction {
  type: 'ERASE';
  id: string;
  points: Point[];
  width: number;
}

export interface ShapeAction {
  type: 'SHAPE';
  id: string;
  shape: 'rect' | 'ellipse';
  from: Point;
  to: Point;
  color: string;
  width: number;
  filled: boolean;
}

export interface ClearAction {
  type: 'CLEAR';
  id: string;
}

export type DrawAction = StrokeAction | EraseAction | ShapeAction | ClearAction;
