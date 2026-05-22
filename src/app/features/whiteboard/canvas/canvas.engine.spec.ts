import { CanvasEngine } from './canvas.engine';
import { ShapeAction } from '../../../core/models/action.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(width = 800, height = 600): CanvasRenderingContext2D {
  return {
    canvas: { width, height } as HTMLCanvasElement,
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
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

// Base shape: normalized coords with a real diagonal to avoid degenerate cases.
const BASE: Omit<ShapeAction, 'id' | 'shape'> = {
  type: 'SHAPE',
  from: { x: 0.1, y: 0.1 },
  to:   { x: 0.5, y: 0.5 },
  color: '#000000',
  width: 2,
  filled: false,
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CanvasEngine', () => {

  // ── drawShape — bounding box symmetry ──────────────────────────────────────

  describe('drawShape — bounding box normalization', () => {
    it('produces identical strokeRect args for NW→SE and SE→NW rect drags', () => {
      const ctx = makeCtx();
      const engine = new CanvasEngine(ctx);
      const strokeRect = ctx.strokeRect as ReturnType<typeof vi.fn>;

      engine.renderAction({ ...BASE, id: '1', shape: 'rect' });
      const [argsNW] = strokeRect.mock.calls;
      strokeRect.mockClear();

      // Reversed from/to simulates dragging in the opposite direction
      engine.renderAction({ ...BASE, id: '2', shape: 'rect', from: BASE.to, to: BASE.from });
      const [argsSE] = strokeRect.mock.calls;

      // Both directions must produce the same bounding box: x=80, y=60, w=320, h=240
      // (with 800×600 canvas, dpr=1: 0.1*800=80, 0.5*800=400, etc.)
      expect(argsNW).toEqual(argsSE);
    });

    it('produces identical ellipse args for NW→SE and SE→NW ellipse drags', () => {
      const ctx = makeCtx();
      const engine = new CanvasEngine(ctx);
      const ellipse = ctx.ellipse as ReturnType<typeof vi.fn>;

      engine.renderAction({ ...BASE, id: '3', shape: 'ellipse' });
      const [argsNW] = ellipse.mock.calls;
      ellipse.mockClear();

      engine.renderAction({ ...BASE, id: '4', shape: 'ellipse', from: BASE.to, to: BASE.from });
      const [argsSE] = ellipse.mock.calls;

      expect(argsNW).toEqual(argsSE);
    });
  });

  // ── renderShapePreview ─────────────────────────────────────────────────────

  describe('renderShapePreview', () => {
    it('uses a dashed stroke to visually distinguish the in-progress shape', () => {
      const ctx = makeCtx();
      const engine = new CanvasEngine(ctx);

      engine.renderShapePreview({ ...BASE, id: '5', shape: 'rect' });

      expect(ctx.setLineDash).toHaveBeenCalledWith([6, 4]);
    });

    it('committed renderAction does NOT use setLineDash', () => {
      const ctx = makeCtx();
      const engine = new CanvasEngine(ctx);

      engine.renderAction({ ...BASE, id: '6', shape: 'rect' });

      expect(ctx.setLineDash).not.toHaveBeenCalled();
    });
  });

  // ── renderEraserCursor ─────────────────────────────────────────────────────

  describe('renderEraserCursor', () => {
    it('draws an arc at the correct physical position', () => {
      const ctx = makeCtx(); // 800×600, window.devicePixelRatio = 1 in jsdom
      const engine = new CanvasEngine(ctx);

      // Normalized (0.5, 0.5) → physical (400, 300); radius = max(20/2, 1) = 10
      engine.renderEraserCursor({ x: 0.5, y: 0.5 }, 20);

      expect(ctx.arc).toHaveBeenCalledWith(400, 300, 10, 0, Math.PI * 2);
    });

    it('uses a dashed stroke for the cursor ring', () => {
      const ctx = makeCtx();
      const engine = new CanvasEngine(ctx);

      engine.renderEraserCursor({ x: 0.25, y: 0.25 }, 16);

      expect(ctx.setLineDash).toHaveBeenCalled();
    });

    it('uses save/restore to isolate the cursor style from subsequent draws', () => {
      const ctx = makeCtx();
      const engine = new CanvasEngine(ctx);

      engine.renderEraserCursor({ x: 0.5, y: 0.5 }, 20);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });
});
