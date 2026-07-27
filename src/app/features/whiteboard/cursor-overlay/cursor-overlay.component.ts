import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
}
