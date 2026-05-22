import {
  DrawAction,
  EraseAction,
  Point,
  ShapeAction,
  StrokeAction,
} from '../../../core/models/action.model';

export class CanvasEngine {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /**
   * Sets canvas buffer size to match physical pixels and applies the DPI
   * transform so all subsequent drawing calls work in CSS pixel coordinates.
   * Call this on init and whenever the canvas element is resized.
   */
  setupDpi(canvas: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Converts a pointer event to a normalized 0–1 Point relative to the canvas. */
  getPoint(event: PointerEvent, canvas: HTMLCanvasElement): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  /**
   * Projects a normalized Point to CSS-pixel coordinates suitable for
   * canvas drawing calls (after the DPI transform is applied via setupDpi).
   */
  toPhysical(p: Point, canvas: HTMLCanvasElement): { x: number; y: number } {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: p.x * (canvas.width / dpr),
      y: p.y * (canvas.height / dpr),
    };
  }

  /** Full repaint from the action log. Clears the canvas first. */
  renderAll(actions: DrawAction[]): void {
    this.clear();
    for (const action of actions) {
      this.renderAction(action);
    }
  }

  /** Renders a single action incrementally (no canvas clear). */
  renderAction(action: DrawAction): void {
    switch (action.type) {
      case 'STROKE': this.drawStroke(action); break;
      case 'ERASE':  this.applyErase(action); break;
      case 'SHAPE':  this.drawShape(action);  break;
      case 'CLEAR':  this.clear();            break;
    }
  }

  /**
   * Renders a shape action as a dashed, semi-transparent outline.
   * Used by the overlay canvas during an active drag to show the
   * in-progress shape without it looking like a committed stroke.
   */
  renderShapePreview(action: ShapeAction): void {
    const { from, to, color, width, shape } = action;
    const { canvas } = this.ctx;

    const f = this.toPhysical(from, canvas);
    const t = this.toPhysical(to, canvas);
    const x = Math.min(f.x, t.x);
    const y = Math.min(f.y, t.y);
    const w = Math.abs(t.x - f.x);
    const h = Math.abs(t.y - f.y);

    this.ctx.save();
    this.ctx.globalAlpha = 0.65;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.setLineDash([6, 4]);
    this.ctx.lineCap = 'round';

    if (shape === 'rect') {
      this.ctx.strokeRect(x, y, w, h);
    } else {
      this.ctx.beginPath();
      this.ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /** Renders a dashed circle at the given point sized to the eraser width. */
  renderEraserCursor(point: Point, width: number): void {
    const { canvas } = this.ctx;
    const p = this.toPhysical(point, canvas);

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(80, 80, 80, 0.75)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([3, 3]);
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, Math.max(width / 2, 1), 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private clear(): void {
    const dpr = window.devicePixelRatio || 1;
    const { canvas } = this.ctx;
    this.ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  }

  private drawStroke(action: StrokeAction): void {
    const { points, color, width } = action;
    if (points.length === 0) return;

    const { canvas } = this.ctx;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (points.length === 1) {
      const p = this.toPhysical(points[0], canvas);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      return;
    }

    this.ctx.beginPath();
    const first = this.toPhysical(points[0], canvas);
    this.ctx.moveTo(first.x, first.y);

    for (let i = 1; i < points.length - 1; i++) {
      const curr = this.toPhysical(points[i], canvas);
      const next = this.toPhysical(points[i + 1], canvas);
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      this.ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }

    const last = this.toPhysical(points[points.length - 1], canvas);
    this.ctx.lineTo(last.x, last.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private applyErase(action: EraseAction): void {
    const { points, width } = action;
    if (points.length === 0) return;

    const { canvas } = this.ctx;

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.strokeStyle = 'rgba(0,0,0,1)';
    this.ctx.fillStyle = 'rgba(0,0,0,1)';
    this.ctx.lineWidth = width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (points.length === 1) {
      const p = this.toPhysical(points[0], canvas);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      return;
    }

    this.ctx.beginPath();
    const first = this.toPhysical(points[0], canvas);
    this.ctx.moveTo(first.x, first.y);

    for (let i = 1; i < points.length - 1; i++) {
      const curr = this.toPhysical(points[i], canvas);
      const next = this.toPhysical(points[i + 1], canvas);
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      this.ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }

    const last = this.toPhysical(points[points.length - 1], canvas);
    this.ctx.lineTo(last.x, last.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawShape(action: ShapeAction): void {
    const { from, to, color, width, shape, filled } = action;
    const { canvas } = this.ctx;

    const f = this.toPhysical(from, canvas);
    const t = this.toPhysical(to, canvas);
    const x = Math.min(f.x, t.x);
    const y = Math.min(f.y, t.y);
    const w = Math.abs(t.x - f.x);
    const h = Math.abs(t.y - f.y);

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = width;

    if (shape === 'rect') {
      filled ? this.ctx.fillRect(x, y, w, h) : this.ctx.strokeRect(x, y, w, h);
    } else {
      this.ctx.beginPath();
      this.ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      filled ? this.ctx.fill() : this.ctx.stroke();
    }

    this.ctx.restore();
  }
}
