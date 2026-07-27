import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RemoteUsersService } from '../../../core/services/remote-users.service';

@Component({
  selector: 'app-cursor-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cursor-overlay.component.html',
  styleUrl: './cursor-overlay.component.css',
})
export class CursorOverlayComponent implements OnInit, OnDestroy {
  protected readonly remoteUsers = inject(RemoteUsersService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /**
   * Overlay's own box, in CSS px — identical to the canvas since both are
   * position:absolute;inset:0 inside the same .board wrapper. Needed to project
   * normalized 0–1 cursor coordinates into a translate() offset, since percentage
   * values inside transform: translate() are relative to the element's own size,
   * not its container.
   */
  protected readonly width = signal(0);
  protected readonly height = signal(0);

  private resizeObserver!: ResizeObserver;

  ngOnInit(): void {
    this.measure();
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private measure(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.width.set(rect.width);
    this.height.set(rect.height);
  }
}
