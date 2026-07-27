import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CanvasViewportService } from '../../../core/services/canvas-viewport.service';
import { RemoteUsersService } from '../../../core/services/remote-users.service';

@Component({
  selector: 'app-cursor-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cursor-overlay.component.html',
  styleUrl: './cursor-overlay.component.css',
})
export class CursorOverlayComponent {
  protected readonly remoteUsers = inject(RemoteUsersService);
  /** Normalized 0–1 cursor coordinates are projected onto the canvas element's own box. */
  protected readonly viewport = inject(CanvasViewportService);
}
