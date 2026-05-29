import { Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { ClearAction, DrawAction, EraseAction, ShapeAction, StrokeAction } from '../../core/models/action.model';
import { BoardState, DrawEventPayload, WireDrawAction } from '../../core/models/socket.types';
import { SocketService } from '../../core/services/socket.service';

export type DrawTool = 'pen' | 'eraser' | 'rect' | 'ellipse';

@Injectable({ providedIn: 'root' })
export class WhiteboardService {
  readonly actions$ = new BehaviorSubject<DrawAction[]>([]);

  readonly tool$ = signal<DrawTool>('pen');
  readonly color$ = signal<string>('#000000');
  readonly strokeWidth$ = signal<number>(4);

  constructor(private readonly socketService: SocketService) {
    socketService.boardState$
      .pipe(takeUntilDestroyed())
      .subscribe((state) => this.seedFromBoardState(state));

    socketService.drawAction$
      .pipe(takeUntilDestroyed())
      .subscribe((wire) => this.applyRemoteAction(wire));
  }

  addAction(action: DrawAction): void {
    this.actions$.next([...this.actions$.getValue(), action]);
    this.socketService.emitAction(this.toWirePayload(action)).subscribe();
  }

  undo(): void {
    const current = this.actions$.getValue();
    if (current.length === 0) return;
    this.actions$.next(current.slice(0, -1));
  }

  clear(): void {
    const action: ClearAction = { type: 'CLEAR', id: crypto.randomUUID() };
    this.addAction(action);
  }

  private applyRemoteAction(wire: WireDrawAction): void {
    const action = this.wireActionToDrawAction(wire);
    if (!action) return;
    this.actions$.next([...this.actions$.getValue(), action]);
  }

  private seedFromBoardState(state: BoardState): void {
    const actions = state.log
      .map((w) => this.wireActionToDrawAction(w))
      .filter((a): a is DrawAction => a !== null);
    this.actions$.next(actions);
  }

  private wireActionToDrawAction(wire: WireDrawAction): DrawAction | null {
    switch (wire.type) {
      case 'stroke':
        return {
          type: 'STROKE',
          id: wire.strokeId,
          points: wire.points,
          color: wire.color,
          width: wire.lineWidth,
        } satisfies StrokeAction;
      case 'erase':
        return {
          type: 'ERASE',
          id: wire.strokeId,
          points: wire.points,
          width: wire.lineWidth,
        } satisfies EraseAction;
      case 'shape':
        return {
          type: 'SHAPE',
          id: wire.strokeId,
          shape: wire.shape,
          from: wire.from,
          to: wire.to,
          color: wire.color,
          width: wire.lineWidth,
          filled: wire.filled,
        } satisfies ShapeAction;
      case 'clear':
        return { type: 'CLEAR', id: wire.strokeId } satisfies ClearAction;
    }
  }

  private toWirePayload(action: DrawAction): DrawEventPayload {
    switch (action.type) {
      case 'STROKE':
        return { type: 'stroke', strokeId: action.id, points: action.points, color: action.color, lineWidth: action.width };
      case 'ERASE':
        return { type: 'erase', strokeId: action.id, points: action.points, lineWidth: action.width };
      case 'SHAPE':
        return { type: 'shape', strokeId: action.id, shape: action.shape, from: action.from, to: action.to, color: action.color, lineWidth: action.width, filled: action.filled };
      case 'CLEAR':
        return { type: 'clear', strokeId: action.id };
    }
  }
}
