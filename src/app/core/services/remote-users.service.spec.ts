import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CursorEvent } from '../models/socket.types';
import { WhiteboardUser } from '../models/user.model';
import { RemoteUsersService } from './remote-users.service';
import { SocketService } from './socket.service';

describe('RemoteUsersService', () => {
  let service: RemoteUsersService;
  let usersRoster$: Subject<WhiteboardUser[]>;
  let userJoined$: Subject<WhiteboardUser>;
  let userLeft$: Subject<string>;
  let cursorMove$: Subject<CursorEvent>;

  const alice: WhiteboardUser = { id: 'alice', name: 'BraveOtter7', color: '#ff0000' };
  const bob: WhiteboardUser = { id: 'bob', name: 'QuietFox1', color: '#00ff00' };

  beforeEach(() => {
    usersRoster$ = new Subject<WhiteboardUser[]>();
    userJoined$ = new Subject<WhiteboardUser>();
    userLeft$ = new Subject<string>();
    cursorMove$ = new Subject<CursorEvent>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SocketService,
          useValue: {
            usersRoster$: usersRoster$.asObservable(),
            userJoined$: userJoined$.asObservable(),
            userLeft$: userLeft$.asObservable(),
            cursorMove$: cursorMove$.asObservable(),
          } as unknown as SocketService,
        },
      ],
    });
    service = TestBed.inject(RemoteUsersService);
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts with no cursors', () => {
    expect(service.cursors()).toEqual([]);
  });

  // ── Roster seeding ───────────────────────────────────────────────────────

  describe('usersRoster$', () => {
    it('does not render a cursor for a rostered user until a position is known', () => {
      usersRoster$.next([alice]);
      expect(service.cursors()).toEqual([]);
    });

    it('drops a previously-rendered cursor for a peer no longer in a fresh roster', () => {
      usersRoster$.next([alice]);
      cursorMove$.next({ userId: 'alice', x: 0.5, y: 0.5 });
      expect(service.cursors()).toHaveLength(1);

      usersRoster$.next([]); // reconnect reseed — alice dropped
      expect(service.cursors()).toEqual([]);
    });
  });

  // ── userJoined$ / userLeft$ ───────────────────────────────────────────────

  describe('userJoined$', () => {
    it('registers identity so a subsequent cursor move renders', () => {
      userJoined$.next(bob);
      cursorMove$.next({ userId: 'bob', x: 0.2, y: 0.3 });

      expect(service.cursors()).toEqual([{ ...bob, x: 0.2, y: 0.3, hidden: false }]);
    });
  });

  describe('userLeft$', () => {
    it('removes the departing user cursor and forgets their identity', () => {
      userJoined$.next(bob);
      cursorMove$.next({ userId: 'bob', x: 0.2, y: 0.3 });
      expect(service.cursors()).toHaveLength(1);

      userLeft$.next('bob');
      expect(service.cursors()).toEqual([]);

      // Identity was forgotten — a stale cursor event for the departed peer is ignored.
      cursorMove$.next({ userId: 'bob', x: 0.9, y: 0.9 });
      expect(service.cursors()).toEqual([]);
    });
  });

  // ── cursorMove$ ───────────────────────────────────────────────────────────

  describe('cursorMove$', () => {
    it('ignores cursor events for a userId with no known identity', () => {
      cursorMove$.next({ userId: 'ghost', x: 0.1, y: 0.1 });
      expect(service.cursors()).toEqual([]);
    });

    it('updates position in place rather than duplicating the entry', () => {
      userJoined$.next(alice);
      cursorMove$.next({ userId: 'alice', x: 0.1, y: 0.1 });
      cursorMove$.next({ userId: 'alice', x: 0.9, y: 0.9 });

      expect(service.cursors()).toEqual([{ ...alice, x: 0.9, y: 0.9, hidden: false }]);
    });

    it('tracks multiple remote users independently', () => {
      userJoined$.next(alice);
      userJoined$.next(bob);
      cursorMove$.next({ userId: 'alice', x: 0.1, y: 0.1 });
      cursorMove$.next({ userId: 'bob', x: 0.8, y: 0.8 });

      const cursors = service.cursors();
      expect(cursors).toHaveLength(2);
      expect(cursors.find((c) => c.id === 'alice')).toMatchObject({ x: 0.1, y: 0.1 });
      expect(cursors.find((c) => c.id === 'bob')).toMatchObject({ x: 0.8, y: 0.8 });
    });
  });

  // ── idle-hide (debounceTime per user stream) ─────────────────────────────

  describe('idle-hide after 3s inactivity', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const cursorFor = (userId: string) => service.cursors().find((c) => c.id === userId);

    it('is visible immediately after a cursor move', () => {
      userJoined$.next(alice);
      cursorMove$.next({ userId: 'alice', x: 0.5, y: 0.5 });

      expect(cursorFor('alice')?.hidden).toBe(false);
    });

    it('flips hidden to true after 3s of no further moves — element stays in the array', () => {
      userJoined$.next(alice);
      cursorMove$.next({ userId: 'alice', x: 0.5, y: 0.5 });

      vi.advanceTimersByTime(3000);

      expect(cursorFor('alice')).toMatchObject({ hidden: true, x: 0.5, y: 0.5 });
    });

    it('does not hide before the 3s window elapses', () => {
      userJoined$.next(alice);
      cursorMove$.next({ userId: 'alice', x: 0.5, y: 0.5 });

      vi.advanceTimersByTime(2999);

      expect(cursorFor('alice')?.hidden).toBe(false);
    });

    it('resets the idle timer on every move — no hide while actively moving', () => {
      userJoined$.next(alice);
      cursorMove$.next({ userId: 'alice', x: 0.1, y: 0.1 });
      vi.advanceTimersByTime(2000);
      cursorMove$.next({ userId: 'alice', x: 0.2, y: 0.2 });
      vi.advanceTimersByTime(2000);

      expect(cursorFor('alice')?.hidden).toBe(false);
    });

    it('reappears (hidden: false) on the next move after being hidden', () => {
      userJoined$.next(alice);
      cursorMove$.next({ userId: 'alice', x: 0.5, y: 0.5 });
      vi.advanceTimersByTime(3000);
      expect(cursorFor('alice')?.hidden).toBe(true);

      cursorMove$.next({ userId: 'alice', x: 0.6, y: 0.6 });

      expect(cursorFor('alice')).toMatchObject({ hidden: false, x: 0.6, y: 0.6 });
    });

    it('tracks idle timers per user independently', () => {
      userJoined$.next(alice);
      userJoined$.next(bob);
      cursorMove$.next({ userId: 'alice', x: 0.1, y: 0.1 });
      vi.advanceTimersByTime(2000);
      cursorMove$.next({ userId: 'bob', x: 0.8, y: 0.8 });
      vi.advanceTimersByTime(1000); // alice at 3000ms idle, bob at 1000ms idle

      expect(cursorFor('alice')?.hidden).toBe(true);
      expect(cursorFor('bob')?.hidden).toBe(false);
    });

    it('does not throw when a user leaves while an idle timer is pending', () => {
      userJoined$.next(alice);
      cursorMove$.next({ userId: 'alice', x: 0.5, y: 0.5 });

      expect(() => {
        userLeft$.next('alice');
        vi.advanceTimersByTime(3000);
      }).not.toThrow();

      expect(service.cursors()).toEqual([]);
    });
  });
});
