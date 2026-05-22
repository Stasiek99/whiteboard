import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ClearAction, DrawAction } from '../../core/models/action.model';

export type DrawTool = 'pen' | 'eraser' | 'rect' | 'ellipse';

@Injectable({ providedIn: 'root' })
export class WhiteboardService {
  readonly actions$ = new BehaviorSubject<DrawAction[]>([]);

  readonly tool$ = signal<DrawTool>('pen');
  readonly color$ = signal<string>('#000000');
  readonly strokeWidth$ = signal<number>(4);

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
}
