import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { DrawAction, EraseAction, ShapeAction, StrokeAction } from '../../../core/models/action.model';
import { WhiteboardService } from '../whiteboard.service';
import { CanvasEngine } from './canvas.engine';

@Component({
  selector: 'app-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #main style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <canvas #overlay style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>
  `,
  styles: [`:host { display: block; position: relative; width: 100%; height: 100%; }`],
})
export class CanvasComponent implements OnInit, OnDestroy {
  @ViewChild('main', { static: true }) private mainRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('overlay', { static: true }) private overlayRef!: ElementRef<HTMLCanvasElement>;

  private readonly zone = inject(NgZone);
  private readonly service = inject(WhiteboardService);
  private readonly host = inject(ElementRef<HTMLElement>);

  private mainEngine!: CanvasEngine;
  private overlayEngine!: CanvasEngine;

  private inProgress: StrokeAction | EraseAction | ShapeAction | null = null;
  private dirty = false;
  private rafId = 0;
  private resizeObserver!: ResizeObserver;
  private actionsSub!: Subscription;
  private readonly unlisten: Array<() => void> = [];

  ngOnInit(): void {
    const main = this.mainRef.nativeElement;
    const overlay = this.overlayRef.nativeElement;

    this.mainEngine = new CanvasEngine(main.getContext('2d')!);
    this.overlayEngine = new CanvasEngine(overlay.getContext('2d')!);

    this.setupDpi();
    this.bindPointerEvents(main);
    this.startRaf();
    this.observeResize();

    this.actionsSub = this.service.actions$.subscribe(actions => {
      this.mainEngine.renderAll(actions);
    });
  }

  ngOnDestroy(): void {
    this.actionsSub.unsubscribe();
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.unlisten.forEach(fn => fn());
  }

  private setupDpi(): void {
    this.mainEngine.setupDpi(this.mainRef.nativeElement);
    this.overlayEngine.setupDpi(this.overlayRef.nativeElement);
  }

  private bindPointerEvents(canvas: HTMLCanvasElement): void {
    const onDown = (e: PointerEvent) => this.onPointerDown(e);
    canvas.addEventListener('pointerdown', onDown);
    this.unlisten.push(() => canvas.removeEventListener('pointerdown', onDown));

    this.zone.runOutsideAngular(() => {
      const onMove = (e: PointerEvent) => this.onPointerMove(e);
      const onUp = (e: PointerEvent) => this.onPointerUp(e);
      const onCancel = (e: PointerEvent) => this.onPointerCancel(e);

      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onCancel);

      this.unlisten.push(
        () => canvas.removeEventListener('pointermove', onMove),
        () => canvas.removeEventListener('pointerup', onUp),
        () => canvas.removeEventListener('pointercancel', onCancel),
      );
    });
  }

  private startRaf(): void {
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      if (!this.dirty) return;
      this.dirty = false;
      this.renderOverlay();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private observeResize(): void {
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        this.setupDpi();
        this.mainEngine.renderAll(this.service.actions$.getValue());
        this.dirty = true;
      });
      this.resizeObserver.observe(this.host.nativeElement);
    });
  }

  private onPointerDown(e: PointerEvent): void {
    const canvas = this.mainRef.nativeElement;
    canvas.setPointerCapture(e.pointerId);

    const pt = this.mainEngine.getPoint(e, canvas);
    const tool = this.service.tool$();
    const color = this.service.color$();
    const width = this.service.strokeWidth$();

    if (tool === 'pen') {
      this.inProgress = { type: 'STROKE', id: crypto.randomUUID(), points: [pt], color, width };
    } else if (tool === 'eraser') {
      this.inProgress = { type: 'ERASE', id: crypto.randomUUID(), points: [pt], width };
    } else {
      this.inProgress = {
        type: 'SHAPE',
        id: crypto.randomUUID(),
        shape: tool === 'rect' ? 'rect' : 'ellipse',
        from: pt,
        to: pt,
        color,
        width,
        filled: false,
      };
    }

    this.dirty = true;
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.inProgress) return;

    const pt = this.mainEngine.getPoint(e, this.mainRef.nativeElement);

    if (this.inProgress.type === 'STROKE' || this.inProgress.type === 'ERASE') {
      this.inProgress.points.push(pt);
    } else {
      this.inProgress.to = pt;
    }

    this.dirty = true;
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.inProgress) return;

    const pt = this.mainEngine.getPoint(e, this.mainRef.nativeElement);

    if (this.inProgress.type === 'STROKE' || this.inProgress.type === 'ERASE') {
      this.inProgress.points.push(pt);
    } else {
      this.inProgress.to = pt;

      // Discard degenerate shapes produced by a click without a real drag.
      const dx = Math.abs(this.inProgress.to.x - this.inProgress.from.x);
      const dy = Math.abs(this.inProgress.to.y - this.inProgress.from.y);
      if (dx < 0.005 && dy < 0.005) {
        this.inProgress = null;
        this.clearOverlay();
        return;
      }
    }

    const committed = this.inProgress as DrawAction;
    this.inProgress = null;
    this.clearOverlay();

    this.zone.run(() => this.service.addAction(committed));
  }

  private onPointerCancel(_e: PointerEvent): void {
    this.inProgress = null;
    this.clearOverlay();
  }

  private renderOverlay(): void {
    const overlay = this.overlayRef.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    overlay.getContext('2d')!.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);

    if (!this.inProgress) return;

    if (this.inProgress.type === 'SHAPE') {
      this.overlayEngine.renderShapePreview(this.inProgress);
    } else {
      this.overlayEngine.renderAction(this.inProgress);
    }
  }

  private clearOverlay(): void {
    const overlay = this.overlayRef.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    overlay.getContext('2d')!.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);
    this.dirty = false;
  }
}
