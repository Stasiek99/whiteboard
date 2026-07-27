import { DestroyRef, Injectable, inject, isDevMode, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { WhiteboardUser } from '../models/user.model';
import { SocketService } from './socket.service';

const IDLE_HIDE_MS = 3000;

export interface RemoteCursor extends WhiteboardUser {
  x: number;
  y: number;
  /** True once the peer has been idle for IDLE_HIDE_MS — CSS-hidden, not removed from the DOM. */
  hidden: boolean;
}

/** Tracks remote peers' identity (name/color), last known cursor position, and idle state. */
@Injectable({ providedIn: 'root' })
export class RemoteUsersService {
  private readonly destroyRef = inject(DestroyRef);

  private readonly identities = new Map<string, WhiteboardUser>();
  /** One debounced activity stream per user — resets its 3s timer on every cursor move. */
  private readonly activity = new Map<string, Subject<void>>();
  private readonly activitySubs = new Map<string, Subscription>();

  private readonly _cursors = signal<RemoteCursor[]>([]);
  readonly cursors = this._cursors.asReadonly();

  constructor(private readonly socketService: SocketService) {
    if (isDevMode()) (window as any).__e2e_remote_users = this;

    this.socketService.usersRoster$
      .pipe(takeUntilDestroyed())
      .subscribe((roster) => this.seedRoster(roster));

    this.socketService.userJoined$
      .pipe(takeUntilDestroyed())
      .subscribe((user) => this.identities.set(user.id, user));

    this.socketService.userLeft$
      .pipe(takeUntilDestroyed())
      .subscribe((userId) => this.removeUser(userId));

    this.socketService.cursorMove$
      .pipe(takeUntilDestroyed())
      .subscribe((event) => this.updateCursor(event.userId, event.x, event.y));
  }

  private seedRoster(roster: WhiteboardUser[]): void {
    this.identities.clear();
    for (const user of roster) this.identities.set(user.id, user);
    // Drop rendered cursors for peers no longer in the roster (replace, not append).
    this._cursors.update((cursors) => cursors.filter((c) => this.identities.has(c.id)));
  }

  private removeUser(userId: string): void {
    this.identities.delete(userId);
    this.activitySubs.get(userId)?.unsubscribe();
    this.activitySubs.delete(userId);
    this.activity.delete(userId);
    this._cursors.update((cursors) => cursors.filter((c) => c.id !== userId));
  }

  private updateCursor(userId: string, x: number, y: number): void {
    const identity = this.identities.get(userId);
    if (!identity) return;

    this._cursors.update((cursors) => {
      const existing = cursors.find((c) => c.id === userId);
      const next: RemoteCursor = { ...identity, x, y, hidden: false };
      return existing ? cursors.map((c) => (c.id === userId ? next : c)) : [...cursors, next];
    });

    this.getActivity(userId).next();
  }

  private getActivity(userId: string): Subject<void> {
    let activity$ = this.activity.get(userId);
    if (activity$) return activity$;

    activity$ = new Subject<void>();
    this.activity.set(userId, activity$);
    this.activitySubs.set(
      userId,
      activity$.pipe(debounceTime(IDLE_HIDE_MS), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.hideCursor(userId)),
    );
    return activity$;
  }

  private hideCursor(userId: string): void {
    this._cursors.update((cursors) => cursors.map((c) => (c.id === userId ? { ...c, hidden: true } : c)));
  }
}
