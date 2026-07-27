import { Injectable, isDevMode, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WhiteboardUser } from '../models/user.model';
import { SocketService } from './socket.service';

export interface RemoteCursor extends WhiteboardUser {
  x: number;
  y: number;
}

/** Tracks remote peers' identity (name/color) and last known cursor position. */
@Injectable({ providedIn: 'root' })
export class RemoteUsersService {
  private readonly identities = new Map<string, WhiteboardUser>();

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
    this._cursors.update((cursors) => cursors.filter((c) => c.id !== userId));
  }

  private updateCursor(userId: string, x: number, y: number): void {
    const identity = this.identities.get(userId);
    if (!identity) return;

    this._cursors.update((cursors) => [
      ...cursors.filter((c) => c.id !== userId),
      { ...identity, x, y },
    ]);
  }
}
