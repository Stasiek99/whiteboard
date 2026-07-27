import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { WhiteboardService } from '../whiteboard.service';
import { CanvasComponent } from './canvas.component';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtxMock(): Partial<CanvasRenderingContext2D> {
  // canvas property needed so CanvasEngine.toPhysical() can read width/height
  // without throwing when rendering is triggered by action commits in tests.
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;

  return {
    canvas,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    ellipse: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: 'round',
    lineJoin: 'round',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  } as unknown as Partial<CanvasRenderingContext2D>;
}

/** Returns a DOMRect-compatible mock covering the full 800×600 canvas area. */
function makeRect(): DOMRect {
  return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

function pointerEvent(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerId: 1, ...init });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CanvasComponent', () => {
  let fixture: ComponentFixture<CanvasComponent>;
  let component: CanvasComponent;
  let service: WhiteboardService;
  let ctxMock: Partial<CanvasRenderingContext2D>;
  let resizeCallback: ResizeObserverCallback;

  beforeEach(async () => {
    ctxMock = makeCtxMock();

    // Canvas context — all canvas elements return the same mock
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctxMock as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(makeRect());

    // jsdom omits setPointerCapture — define it as a no-op so vi.spyOn can wrap it
    if (typeof HTMLCanvasElement.prototype.setPointerCapture !== 'function') {
      Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
        value: () => {},
        writable: true,
        configurable: true,
      });
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'setPointerCapture').mockImplementation(() => {});

    // ResizeObserver — capture the callback so tests can trigger it manually
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          resizeCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );

    // rAF — prevent the real animation loop from running during tests
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    await TestBed.configureTestingModule({
      imports: [CanvasComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CanvasComponent);
    component = fixture.componentInstance;
    service = TestBed.inject(WhiteboardService);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── Test 1: point normalization ─────────────────────────────────────────

  describe('point normalization', () => {
    it('committed points are floats in [0, 1] range, not raw pixels', () => {
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      // Canvas is mocked to 800×600 starting at (0,0).
      // clientX=200, clientY=150 → x=200/800=0.25, y=150/600=0.25
      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 200, clientY: 150 }));
      canvas.dispatchEvent(pointerEvent('pointerup', { clientX: 200, clientY: 150 }));

      const actions = service.actions$.getValue();
      expect(actions).toHaveLength(1);

      const action = actions[0] as { points: { x: number; y: number }[] };
      expect(action.points.length).toBeGreaterThan(0);

      for (const p of action.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    });

    it('maps canvas position to correct normalized values', () => {
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 400, clientY: 300 }));
      canvas.dispatchEvent(pointerEvent('pointerup', { clientX: 400, clientY: 300 }));

      const action = service.actions$.getValue()[0] as { points: { x: number; y: number }[] };
      expect(action.points[0].x).toBeCloseTo(0.5);
      expect(action.points[0].y).toBeCloseTo(0.5);
    });
  });

  // ── Test 2: undo clears the action log ──────────────────────────────────

  describe('undo()', () => {
    it('removes the committed stroke and leaves the log empty', () => {
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointerEvent('pointerup', { clientX: 120, clientY: 120 }));
      expect(service.actions$.getValue()).toHaveLength(1);

      service.undo();
      expect(service.actions$.getValue()).toHaveLength(0);
    });
  });

  // ── Test 3: clear() appends ClearAction ─────────────────────────────────

  describe('clear()', () => {
    it('appends a ClearAction as the last entry', () => {
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;
      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointerEvent('pointerup', { clientX: 120, clientY: 120 }));

      service.clear();

      const log = service.actions$.getValue();
      expect(log.at(-1)?.type).toBe('CLEAR');
    });
  });

  // ── Test 4: pointercancel discards in-progress stroke ───────────────────

  describe('pointercancel', () => {
    it('does not commit an action to the log', () => {
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 120, clientY: 120 }));
      canvas.dispatchEvent(pointerEvent('pointercancel'));

      expect(service.actions$.getValue()).toHaveLength(0);
    });

    it('sets inProgress to null so no ghost stroke can appear', () => {
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointerEvent('pointercancel'));

      expect((component as unknown as { inProgress: unknown }).inProgress).toBeNull();
    });
  });

  // ── Test 5: resize re-renders without drift ──────────────────────────────

  describe('ResizeObserver', () => {
    it('calls renderAll on the main engine after resize', () => {
      const mainEngine = (component as unknown as { mainEngine: { renderAll: () => void; setupDpi: () => void } }).mainEngine;
      const renderAllSpy = vi.spyOn(mainEngine, 'renderAll');

      resizeCallback([], new ResizeObserver(() => {}));

      expect(renderAllSpy).toHaveBeenCalledWith(service.actions$.getValue());
    });

    it('re-runs DPI setup on resize', () => {
      const mainEngine = (component as unknown as { mainEngine: { renderAll: () => void; setupDpi: (c: HTMLCanvasElement) => void } }).mainEngine;
      const setupSpy = vi.spyOn(mainEngine, 'setupDpi');

      resizeCallback([], new ResizeObserver(() => {}));

      expect(setupSpy).toHaveBeenCalled();
    });
  });

  // ── Test 6: HiDPI — setTransform called with correct DPR ────────────────

  describe('HiDPI setup', () => {
    it('passes devicePixelRatio to setTransform during DPI setup', () => {
      vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);

      // Trigger re-setup via ResizeObserver
      resizeCallback([], new ResizeObserver(() => {}));

      expect(ctxMock.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    });

    it('applies the 2x DPI transform to both the main and overlay canvas', () => {
      vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
      (ctxMock.setTransform as ReturnType<typeof vi.fn>).mockClear();

      resizeCallback([], new ResizeObserver(() => {}));

      // setupDpi() is called once for the main canvas and once for the overlay.
      // Both share the same ctxMock (getContext is mocked globally), so
      // setTransform must be called exactly twice — mismatched DPI on either
      // canvas would cause shape preview misalignment on retina displays.
      expect(ctxMock.setTransform).toHaveBeenCalledTimes(2);
      expect(ctxMock.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    });
  });

  // ── Test 7: SHAPE action committed when rect/ellipse tool is active ───────

  describe('SHAPE action', () => {
    it('commits action with type SHAPE, normalized from/to, and from !== to', () => {
      service.tool$.set('rect');
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      // clientX/Y at 100,100 → normalized (0.125, 0.167); drag to 400,300 → (0.5, 0.5)
      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 300 }));
      canvas.dispatchEvent(pointerEvent('pointerup',  { clientX: 400, clientY: 300 }));

      const actions = service.actions$.getValue();
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('SHAPE');

      const action = actions[0];
      if (action.type !== 'SHAPE') return;

      for (const coord of [action.from.x, action.from.y, action.to.x, action.to.y]) {
        expect(coord).toBeGreaterThanOrEqual(0);
        expect(coord).toBeLessThanOrEqual(1);
      }
      expect(action.from.x).not.toBeCloseTo(action.to.x, 3);
      expect(action.from.y).not.toBeCloseTo(action.to.y, 3);
    });

    it('does not commit a SHAPE when the pointer is released without a meaningful drag', () => {
      service.tool$.set('rect');
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 300, clientY: 200 }));
      canvas.dispatchEvent(pointerEvent('pointerup',  { clientX: 300, clientY: 200 }));

      expect(service.actions$.getValue()).toHaveLength(0);
    });
  });

  // ── Test 8: mid-stroke tool switch ───────────────────────────────────────

  describe('mid-stroke tool switch', () => {
    it('locks the action type to the tool active at pointerdown, not at pointerup', () => {
      service.tool$.set('pen');
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));

      // Switch tool while the pointer is still down
      service.tool$.set('eraser');

      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 150 }));
      canvas.dispatchEvent(pointerEvent('pointerup',  { clientX: 200, clientY: 200 }));

      const actions = service.actions$.getValue();
      expect(actions).toHaveLength(1);
      // Type is captured at pointerdown — switching mid-stroke must not inject
      // destination-out composite into a stroke that started as a pen action.
      expect(actions[0].type).toBe('STROKE');
    });
  });

  // ── Test 10: cursor emission ─────────────────────────────────────────────

  describe('cursor emission', () => {
    let emitCursorSpy: ReturnType<typeof vi.spyOn>;
    let canvas: HTMLCanvasElement;

    beforeEach(() => {
      canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;
      emitCursorSpy = vi.spyOn(service, 'emitCursor').mockImplementation(() => {});
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not call emitCursor synchronously on pointermove — auditTime must elapse first', () => {
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 300 }));

      expect(emitCursorSpy).not.toHaveBeenCalled();
    });

    it('calls emitCursor once after 33ms with the normalized pointer position', () => {
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 300 }));
      vi.advanceTimersByTime(33);

      // clientX=400/width=800 → x=0.5; clientY=300/height=600 → y=0.5
      expect(emitCursorSpy).toHaveBeenCalledOnce();
      expect(emitCursorSpy).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
    });

    it('emits the last point in the window — auditTime, not throttleTime', () => {
      // Three moves arrive within a single 33ms window
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 100, clientY: 100 })); // x=0.125, y=0.1667
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 200, clientY: 150 })); // x=0.25,  y=0.25
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 300 })); // x=0.5,   y=0.5  ← last
      vi.advanceTimersByTime(33);

      // throttleTime would emit the first (0.125, 0.1667); auditTime emits the last
      expect(emitCursorSpy).toHaveBeenCalledOnce();
      expect(emitCursorSpy).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
    });

    it('opens a new window after each flush — moves separated by >33ms each produce an emission', () => {
      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 200, clientY: 150 }));
      vi.advanceTimersByTime(33);

      canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 300 }));
      vi.advanceTimersByTime(33);

      expect(emitCursorSpy).toHaveBeenCalledTimes(2);
    });

    it('pointerleave does not push to cursorMove$ — no cursor emission on leave', () => {
      canvas.dispatchEvent(pointerEvent('pointerleave'));
      vi.advanceTimersByTime(100);

      expect(emitCursorSpy).not.toHaveBeenCalled();
    });
  });

  // ── Test 9: eraser — known MVP limitation ────────────────────────────────

  describe('eraser — known MVP limitation', () => {
    it('undo is strictly LIFO: cannot remove a stroke independently of a later erase', () => {
      const canvas = fixture.debugElement.query(By.css('canvas')).nativeElement as HTMLCanvasElement;

      // Draw a stroke
      service.tool$.set('pen');
      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointerEvent('pointerup',  { clientX: 300, clientY: 100 }));

      // Apply eraser over the stroke
      service.tool$.set('eraser');
      canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 150, clientY: 100 }));
      canvas.dispatchEvent(pointerEvent('pointerup',  { clientX: 250, clientY: 100 }));

      expect(service.actions$.getValue().map(a => a.type)).toEqual(['STROKE', 'ERASE']);

      // Undo removes in LIFO order only
      service.undo();
      expect(service.actions$.getValue().map(a => a.type)).toEqual(['STROKE']);

      service.undo();
      expect(service.actions$.getValue()).toHaveLength(0);

      // Known MVP limitation: it is impossible to undo a stroke that was drawn
      // before an erase while keeping the erase in the log. Any out-of-order
      // removal (e.g. via network sync in Phase 3) would replay the erase against
      // an empty canvas — the destination-out has nothing to cut through, so the
      // "erased" region is not transparent. Post-MVP fix: scene graph or
      // per-stroke clip paths.
    });
  });
});
