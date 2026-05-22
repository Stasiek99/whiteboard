import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { WhiteboardService } from '../whiteboard.service';
import { CanvasComponent } from './canvas.component';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtxMock(): Partial<CanvasRenderingContext2D> {
  return {
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
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: 'round',
    lineJoin: 'round',
    globalCompositeOperation: 'source-over',
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
  });
});
