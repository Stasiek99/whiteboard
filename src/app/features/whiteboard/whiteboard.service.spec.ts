import { TestBed } from '@angular/core/testing';
import { StrokeAction } from '../../core/models/action.model';
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

  beforeEach(() => {
    TestBed.configureTestingModule({});
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
});
