import { Component } from '@angular/core';
import { CanvasComponent } from './features/whiteboard/canvas/canvas.component';
import { CursorOverlayComponent } from './features/whiteboard/cursor-overlay/cursor-overlay.component';
import { ToolbarComponent } from './features/whiteboard/toolbar/toolbar.component';

@Component({
  selector: 'app-root',
  imports: [CanvasComponent, CursorOverlayComponent, ToolbarComponent],
  template: `
    <div class="board">
      <app-canvas />
      <app-cursor-overlay />
    </div>
    <app-toolbar />
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100dvh; }
    .board { position: relative; width: 100%; height: 100%; }
  `],
})
export class App {}
