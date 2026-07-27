import { Injectable, signal } from '@angular/core';

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Published by CanvasComponent from the canvas element's own getBoundingClientRect()
 * (on init and on resize); consumed by CursorOverlayComponent to project normalized
 * 0–1 remote cursor coordinates into CSS pixels at render time.
 */
@Injectable({ providedIn: 'root' })
export class CanvasViewportService {
  private readonly _size = signal<ViewportSize>({ width: 0, height: 0 });
  readonly size = this._size.asReadonly();

  setSize(size: ViewportSize): void {
    this._size.set(size);
  }
}
