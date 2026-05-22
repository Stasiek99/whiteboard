import { Component } from '@angular/core';
import { CanvasComponent } from './features/whiteboard/canvas/canvas.component';

@Component({
  selector: 'app-root',
  imports: [CanvasComponent],
  template: `<app-canvas />`,
  styles: [`:host { display: block; width: 100%; height: 100dvh; }`],
})
export class App {}
