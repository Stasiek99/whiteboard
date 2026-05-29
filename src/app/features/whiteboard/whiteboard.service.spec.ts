import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';
import { EraseAction, ShapeAction, StrokeAction } from '../../core/models/action.model';
import { BoardState, DrawEventPayload, WireDrawAction } from '../../core/models/socket.types';
import { SocketService } from '../../core/services/socket.service';
import { WhiteboardService } from './whiteboard.service';

const makeStroke = (id = '1'): StrokeAction => ({
  type: 'STROKE',
  id,
  points: [{ x: 0.1, y: 0.2 }],
  color: '#000000',
  width: 4,
});

const makeErase = (id = 'e1'): EraseAction => ({
  type: 'ERASE',
  id,
  points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }],
  width: 20,
});

const makeShape = (id = 'sh1'): ShapeAction => ({
  type: 'SHAPE',
  id,
  shape: 'rect',
  from: { x: 0.1, y: 0.1 },
  to: { x: 0.8, y: 0.9 },
  color: '#ff0000',
  width: 3,
  filled: false,
});

const wireStroke = (strokeId = 's1', overrides: Partial<WireDrawAction> = {}): WireDrawAction =>
  ({ type: 'stroke', strokeId, points: [{ x: 0.1, y: 0.2 }], color: '#ff0000', lineWidth: 6, userId: 'u1', seq: 1, ...overrides } as WireDrawAction);

describe('WhiteboardService', () => {
  let service: WhiteboardService;
  let boardState$: Subject<BoardState>;
  let drawAction$: Subject<WireDrawAction>;
  let emitCalls: DrawEventPayload[];

  beforeEach(() => {
    boardState$ = new Subject<BoardState>();
    drawAction$ = new Subject<WireDrawAction>();
    emitCalls = [];

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SocketService,
          useValue: {
            boardState$: boardState$.asObservable(),
            drawAction$: drawAction$.asObservable(),
            emitAction: (payload: DrawEventPayload) => { emitCalls.push(payload); return EMPTY; },
          } as unknown as SocketService,
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

    it('emits a stroke wire payload to the socket', () => {
      service.addAction(makeStroke('x'));

      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]).toMatchObject({
        type: 'stroke',
        strokeId: 'x',
        points: [{ x: 0.1, y: 0.2 }],
        color: '#000000',
        lineWidth: 4,
      });
    });

    it('emits a clear wire payload to the socket when clear() is called', () => {
      service.clear();
      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]).toMatchObject({ type: 'clear' });
    });

    it('emits an erase wire payload with all points in one message', () => {
      service.addAction(makeErase('er1'));

      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]).toMatchObject({
        type: 'erase',
        strokeId: 'er1',
        points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }],
        lineWidth: 20,
      });
    });

    it('emits a shape wire payload with from/to geometry', () => {
      service.addAction(makeShape('sh2'));

      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]).toMatchObject({
        type: 'shape',
        strokeId: 'sh2',
        shape: 'rect',
        from: { x: 0.1, y: 0.1 },
        to: { x: 0.8, y: 0.9 },
        color: '#ff0000',
        lineWidth: 3,
        filled: false,
      });
    });

    it('emits exactly one socket message per addAction() call — never per-point', () => {
      const stroke = makeStroke('multi');
      stroke.points = [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
        { x: 0.4, y: 0.4 },
        { x: 0.5, y: 0.5 },
      ];

      service.addAction(stroke);

      expect(emitCalls).toHaveLength(1);
    });

    it('emits all accumulated points in that single message', () => {
      const stroke = makeStroke('all-pts');
      stroke.points = [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.9, y: 0.9 },
      ];

      service.addAction(stroke);

      const payload = emitCalls[0];
      if (payload.type !== 'stroke') throw new Error('expected stroke type');
      expect(payload.points).toHaveLength(3);
      expect(payload.points[2]).toEqual({ x: 0.9, y: 0.9 });
    });

    it('emits N messages for N sequential addAction() calls — no batching', () => {
      service.addAction(makeStroke('a'));
      service.addAction(makeStroke('b'));
      service.addAction(makeStroke('c'));

      expect(emitCalls).toHaveLength(3);
      expect(emitCalls.map((p) => (p as { strokeId: string }).strokeId)).toEqual(['a', 'b', 'c']);
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

    it('does not emit to the socket — undo is local only', () => {
      service.addAction(makeStroke('a'));
      emitCalls.length = 0; // clear the addAction emit

      service.undo();

      expect(emitCalls).toHaveLength(0);
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

    it('maps a wire stroke to a StrokeAction', () => {
      boardState$.next({
        seq: 1,
        log: [wireStroke('s1', { points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], color: '#ff0000', lineWidth: 6 })],
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

    it('maps a wire erase to an EraseAction', () => {
      boardState$.next({
        seq: 1,
        log: [{ type: 'erase', strokeId: 'e1', points: [{ x: 0.5, y: 0.5 }], lineWidth: 20, userId: 'u1', seq: 1 }],
      });

      expect(service.actions$.getValue()[0]).toMatchObject({ type: 'ERASE', id: 'e1', width: 20 });
    });

    it('maps a wire shape to a ShapeAction', () => {
      boardState$.next({
        seq: 1,
        log: [{
          type: 'shape', strokeId: 'sh1', shape: 'rect',
          from: { x: 0.1, y: 0.1 }, to: { x: 0.9, y: 0.9 },
          color: '#abc', lineWidth: 3, filled: false,
          userId: 'u1', seq: 1,
        }],
      });

      expect(service.actions$.getValue()[0]).toMatchObject({ type: 'SHAPE', id: 'sh1', shape: 'rect' });
    });

    it('maps a wire clear to a ClearAction', () => {
      boardState$.next({
        seq: 1,
        log: [{ type: 'clear', strokeId: 'clr-1', userId: 'u1', seq: 1 }],
      });

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ type: 'CLEAR', id: 'clr-1' });
    });

    it('preserves ordering: strokes and clears appear in log order', () => {
      boardState$.next({
        seq: 3,
        log: [
          wireStroke('a', { seq: 1 }),
          { type: 'clear', strokeId: 'clr', userId: 'u1', seq: 2 },
          wireStroke('b', { userId: 'u2', seq: 3 }),
        ],
      });

      const types = service.actions$.getValue().map((a) => a.type);
      expect(types).toEqual(['STROKE', 'CLEAR', 'STROKE']);
    });
  });

  // ── remote draw:action ───────────────────────────────────────────────────

  describe('remote drawAction$', () => {
    it('appends an incoming stroke from another user', () => {
      drawAction$.next(wireStroke('remote-1'));

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ type: 'STROKE', id: 'remote-1' });
    });

    it('does not emit to socket for remote actions', () => {
      drawAction$.next(wireStroke('remote-2'));
      expect(emitCalls).toHaveLength(0);
    });

    it('appends remote actions after local ones', () => {
      service.addAction(makeStroke('local'));
      drawAction$.next(wireStroke('remote'));

      const ids = service.actions$.getValue().map((a) => a.id);
      expect(ids).toEqual(['local', 'remote']);
    });

    it('applies a remote erase action as EraseAction', () => {
      drawAction$.next({
        type: 'erase',
        strokeId: 'er-remote',
        points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }],
        lineWidth: 16,
        userId: 'u2',
        seq: 1,
      });

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ type: 'ERASE', id: 'er-remote', width: 16 });
    });

    it('applies a remote shape action as ShapeAction', () => {
      drawAction$.next({
        type: 'shape',
        strokeId: 'sh-remote',
        shape: 'ellipse',
        from: { x: 0.2, y: 0.2 },
        to: { x: 0.7, y: 0.8 },
        color: '#0000ff',
        lineWidth: 2,
        filled: true,
        userId: 'u2',
        seq: 1,
      });

      const log = service.actions$.getValue();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: 'SHAPE',
        id: 'sh-remote',
        shape: 'ellipse',
        filled: true,
        color: '#0000ff',
      });
    });

    it('applies a remote clear as ClearAction', () => {
      service.addAction(makeStroke('before'));
      drawAction$.next({ type: 'clear', strokeId: 'clr-remote', userId: 'u2', seq: 2 });

      const log = service.actions$.getValue();
      expect(log).toHaveLength(2);
      expect(log[1]).toMatchObject({ type: 'CLEAR', id: 'clr-remote' });
    });

    it('accumulates multiple remote actions in order', () => {
      drawAction$.next(wireStroke('r1', { seq: 1 }));
      drawAction$.next(wireStroke('r2', { seq: 2 }));
      drawAction$.next({ type: 'clear', strokeId: 'clr', userId: 'u1', seq: 3 });

      const types = service.actions$.getValue().map((a) => a.type);
      expect(types).toEqual(['STROKE', 'STROKE', 'CLEAR']);
    });

    it('does not emit to socket even when multiple remote actions arrive', () => {
      drawAction$.next(wireStroke('r1'));
      drawAction$.next(wireStroke('r2'));
      drawAction$.next(wireStroke('r3'));

      expect(emitCalls).toHaveLength(0);
    });
  });
});
