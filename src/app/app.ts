import { Component } from '@angular/core';
import { CanvasComponent } from './features/whiteboard/canvas/canvas.component';
import { ToolbarComponent } from './features/whiteboard/toolbar/toolbar.component';

@Component({
  selector: 'app-root',
  imports: [CanvasComponent, ToolbarComponent],
  template: `<app-canvas /><app-toolbar />`,
  styles: [`:host { display: block; width: 100%; height: 100dvh; }`],
})
export class App {}
