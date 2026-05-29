import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { StrokeAction } from '../../core/models/action.model';
import { BoardState } from '../../core/models/socket.types';
import { SocketService } from '../../core/services/socket.service';
import { WhiteboardService } from './whiteboard.service';

const makeStroke = (id = '1'): StrokeAction => ({
  type: 'STROKE',
  id,
  points: [{ x: 0.1, y: 0.2 }],
  color: '#000000',
  width: 4,
});

describe('WhiteboardService', () => {
  let service: WhiteboardService;
  let boardState$: Subject<BoardState>;

  beforeEach(() => {
    boardState$ = new Subject<BoardState>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SocketService,
          useValue: { boardState$: boardState$.asObservable() } as unknown as SocketService,
        },
      ],
    });
    service = TestBed.inject(WhiteboardService);
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('initializes with an empty action log', () => {
    expect(service.actions$.getValue()).toEqual([]);
  });

  it('has default signal values', () => {
    expect(service.tool$()).toBe('pen');
    expect(service.color$()).toBe('#000000');
    expect(service.strokeWidth$()).toBe(4);
  });

  // ── addAction() ───────────────────────────────────────────────────────────

  describe('addAction()', () => {
    it('appends an action to the log', () => {
      const action = makeStroke();
      service.addAction(action);
      expect(service.actions$.getValue()).toHaveLength(1);
      expect(service.actions$.getValue()[0]).toBe(action);
    });

    it('does not mutate the previous snapshot', () => {
      service.addAction(makeStroke('a'));
      const snapshot = service.actions$.getValue();

      service.addAction(makeStroke('b'));

      expect(snapshot).toHaveLength(1);
      expect(service.actions$.getValue()).toHaveLength(2);
    });
  });

  // ── undo() ────────────────────────────────────────────────────────────────

  describe('undo()', () => {
    it('removes the last action', () => {
      service.addAction(makeStroke('a'));
      service.addAction(makeStroke('b'));
      service.undo();

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0].id).toBe('a');
    });

    it('is a no-op on an empty log', () => {
      expect(() => service.undo()).not.toThrow();
      expect(service.actions$.getValue()).toHaveLength(0);
    });
  });

  // ── clear() ───────────────────────────────────────────────────────────────

  describe('clear()', () => {
    it('appends a ClearAction to the log', () => {
      service.addAction(makeStroke());
      service.clear();

      const log = service.actions$.getValue();
      expect(log).toHaveLength(2);
      expect(log[1].type).toBe('CLEAR');
    });

    it('each ClearAction has a unique id', () => {
      service.clear();
      service.clear();

      const [a, b] = service.actions$.getValue();
      expect(a.id).not.toBe(b.id);
    });

    it('clear is undoable and restores prior strokes', () => {
      service.addAction(makeStroke());
      service.clear();
      service.undo();

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe('STROKE');
    });
  });

  // ── signals ───────────────────────────────────────────────────────────────

  describe('signals', () => {
    it('tool$ is writable', () => {
      service.tool$.set('eraser');
      expect(service.tool$()).toBe('eraser');
    });

    it('color$ is writable', () => {
      service.color$.set('#ff0000');
      expect(service.color$()).toBe('#ff0000');
    });

    it('strokeWidth$ is writable', () => {
      service.strokeWidth$.set(12);
      expect(service.strokeWidth$()).toBe(12);
    });
  });

  // ── boardState$ seeding ───────────────────────────────────────────────────

  describe('boardState$ seeding', () => {
    it('replaces the local log — does not append', () => {
      service.addAction(makeStroke('local-a'));
      service.addAction(makeStroke('local-b'));

      boardState$.next({ seq: 1, log: [] });

      expect(service.actions$.getValue()).toHaveLength(0);
    });

    it('replaces on every subsequent boardState$ emission (reconnect reseed)', () => {
      boardState$.next({ seq: 1, log: [] });
      service.addAction(makeStroke('interim'));

      boardState$.next({ seq: 2, log: [] });

      expect(service.actions$.getValue()).toHaveLength(0);
    });

    it('reconstructs completed strokes from stroke_start/move/end events', () => {
      boardState$.next({
        seq: 3,
        log: [
          { type: 'stroke_start', strokeId: 's1', point: { x: 0.1, y: 0.2 }, color: '#ff0000', lineWidth: 6, userId: 'u1', seq: 1 },
          { type: 'stroke_move',  strokeId: 's1', point: { x: 0.3, y: 0.4 }, userId: 'u1', seq: 2 },
          { type: 'stroke_end',   strokeId: 's1', userId: 'u1', seq: 3 },
        ],
      });

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: 'STROKE',
        id: 's1',
        color: '#ff0000',
        width: 6,
        points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
      });
    });

    it('maps wire clear events to ClearAction', () => {
      boardState$.next({
        seq: 4,
        log: [
          { type: 'clear', strokeId: 'clr-1', userId: 'u1', seq: 1 },
        ],
      });

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ type: 'CLEAR', id: 'clr-1' });
    });

    it('preserves ordering: strokes and clears appear in log order', () => {
      boardState$.next({
        seq: 5,
        log: [
          { type: 'stroke_start', strokeId: 'a', point: { x: 0, y: 0 }, color: '#000', lineWidth: 2, userId: 'u1', seq: 1 },
          { type: 'stroke_end',   strokeId: 'a', userId: 'u1', seq: 2 },
          { type: 'clear',        strokeId: 'clr', userId: 'u1', seq: 3 },
          { type: 'stroke_start', strokeId: 'b', point: { x: 1, y: 1 }, color: '#fff', lineWidth: 2, userId: 'u2', seq: 4 },
          { type: 'stroke_end',   strokeId: 'b', userId: 'u2', seq: 5 },
        ],
      });

      const types = service.actions$.getValue().map((a) => a.type);
      expect(types).toEqual(['STROKE', 'CLEAR', 'STROKE']);
    });

    it('drops an incomplete stroke (no stroke_end) — no partial actions', () => {
      boardState$.next({
        seq: 6,
        log: [
          { type: 'stroke_start', strokeId: 'incomplete', point: { x: 0.5, y: 0.5 }, color: '#000', lineWidth: 2, userId: 'u1', seq: 1 },
          { type: 'stroke_move',  strokeId: 'incomplete', point: { x: 0.6, y: 0.6 }, userId: 'u1', seq: 2 },
          // no stroke_end
        ],
      });

      expect(service.actions$.getValue()).toHaveLength(0);
    });

    it('falls back to #000000 color when stroke_start omits color', () => {
      boardState$.next({
        seq: 7,
        log: [
          { type: 'stroke_start', strokeId: 'nc', point: { x: 0, y: 0 }, userId: 'u1', seq: 1 },
          { type: 'stroke_end',   strokeId: 'nc', userId: 'u1', seq: 2 },
        ],
      });

      expect(service.actions$.getValue()[0]).toMatchObject({ type: 'STROKE', color: '#000000' });
    });

    it('falls back to width 4 when stroke_start omits lineWidth', () => {
      boardState$.next({
        seq: 8,
        log: [
          { type: 'stroke_start', strokeId: 'nw', point: { x: 0, y: 0 }, color: '#abc', userId: 'u1', seq: 1 },
          { type: 'stroke_end',   strokeId: 'nw', userId: 'u1', seq: 2 },
        ],
      });

      expect(service.actions$.getValue()[0]).toMatchObject({ type: 'STROKE', width: 4 });
    });

    it('silently ignores a stroke_start that carries no point', () => {
      boardState$.next({
        seq: 9,
        log: [
          { type: 'stroke_start', strokeId: 'nopoint', userId: 'u1', seq: 1 },
          { type: 'stroke_end',   strokeId: 'nopoint', userId: 'u1', seq: 2 },
        ],
      });

      expect(service.actions$.getValue()).toHaveLength(0);
    });

    it('silently ignores a stroke_move with no prior stroke_start', () => {
      boardState$.next({
        seq: 10,
        log: [
          { type: 'stroke_move', strokeId: 'orphan', point: { x: 0.5, y: 0.5 }, userId: 'u1', seq: 1 },
          { type: 'stroke_end',  strokeId: 'orphan', userId: 'u1', seq: 2 },
        ],
      });

      expect(service.actions$.getValue()).toHaveLength(0);
    });
  });
});
