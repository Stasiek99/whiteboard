import { Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { ClearAction, DrawAction, StrokeAction } from '../../core/models/action.model';
import { BoardState, WireDrawAction } from '../../core/models/socket.types';
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
  }

  addAction(action: DrawAction): void {
    this.actions$.next([...this.actions$.getValue(), action]);
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

  private seedFromBoardState(state: BoardState): void {
    this.actions$.next(this.wireLogToActions(state.log));
  }

  private wireLogToActions(log: WireDrawAction[]): DrawAction[] {
    type StrokeAccum = { points: Array<{ x: number; y: number }>; color: string; width: number };
    const inProgress = new Map<string, StrokeAccum>();
    const actions: DrawAction[] = [];

    for (const event of log) {
      if (event.type === 'clear') {
        actions.push({ type: 'CLEAR', id: event.strokeId });
        continue;
      }

      if (event.type === 'stroke_start' && event.point) {
        inProgress.set(event.strokeId, {
          points: [event.point],
          color: event.color ?? '#000000',
          width: event.lineWidth ?? 4,
        });
      } else if (event.type === 'stroke_move' && event.point) {
        inProgress.get(event.strokeId)?.points.push(event.point);
      } else if (event.type === 'stroke_end') {
        const stroke = inProgress.get(event.strokeId);
        if (stroke) {
          const action: StrokeAction = {
            type: 'STROKE',
            id: event.strokeId,
            points: stroke.points,
            color: stroke.color,
            width: stroke.width,
          };
          actions.push(action);
          inProgress.delete(event.strokeId);
        }
      }
    }

    return actions;
  }
}
