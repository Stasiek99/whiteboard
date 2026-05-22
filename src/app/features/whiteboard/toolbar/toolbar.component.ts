import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
} from '@angular/core';
import { DrawTool, WhiteboardService } from '../whiteboard.service';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.css',
})
export class ToolbarComponent {
  protected readonly wb = inject(WhiteboardService);

  readonly tools: { id: DrawTool; label: string }[] = [
    { id: 'pen', label: 'Pen (P)' },
    { id: 'eraser', label: 'Eraser (E)' },
    { id: 'rect', label: 'Rectangle (R)' },
    { id: 'ellipse', label: 'Ellipse (L)' },
  ];

  readonly swatches: string[] = [
    '#1a1a1a', '#ffffff',
    '#ef4444', '#f97316',
    '#eab308', '#22c55e',
    '#3b82f6', '#a855f7',
  ];

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      this.wb.undo();
      return;
    }

    const toolMap: Record<string, DrawTool> = { p: 'pen', e: 'eraser', r: 'rect', l: 'ellipse' };
    const mapped = toolMap[e.key.toLowerCase()];
    if (mapped) this.wb.tool$.set(mapped);
  }

  onColorChange(e: Event): void {
    this.wb.color$.set((e.target as HTMLInputElement).value);
  }

  onWidthChange(e: Event): void {
    this.wb.strokeWidth$.set((e.target as HTMLInputElement).valueAsNumber);
  }
}
