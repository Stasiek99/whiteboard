import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { io } from 'socket.io-client';
import type {
  BoardState,
  CursorEvent,
  CursorPayload,
  DrawEventPayload,
  WireDrawAction,
} from '../models/socket.types';
import { SocketService } from './socket.service';

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

// ── Mock socket type ───────────────────────────────────────────────────────────

type MockSocket = {
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connected: boolean;
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SocketService', () => {
  let service: SocketService;
  let mockSocket: MockSocket;

  /** Returns the handler registered for a given socket event name. */
  const getHandler = (event: string): ((...args: unknown[]) => void) => {
    const call = mockSocket.on.mock.calls.find((args: any[]) => args[0] === event);
    if (!call) throw new Error(`No handler registered for socket event "${event}"`);
    return call[1] as (...args: unknown[]) => void;
  };

  beforeEach(() => {
    mockSocket = {
      on: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
    };

    vi.mocked(io).mockReturnValue(mockSocket as any);

    TestBed.configureTestingModule({});
    service = TestBed.inject(SocketService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor / connection ───────────────────────────────────────────────

  describe('constructor', () => {
    it('connects to localhost:3000 with websocket-only transport', () => {
      expect(io).toHaveBeenCalledWith('http://localhost:3000', expect.objectContaining({
        transports: ['websocket'],
      }));
    });

    it('registers handlers for all expected socket events', () => {
      const registered = mockSocket.on.mock.calls.map((args: any[]) => args[0]);
      expect(registered).toContain('connect');
      expect(registered).toContain('draw:action');
      expect(registered).toContain('draw:cursor');
      expect(registered).toContain('board:state');
      expect(registered).toContain('user:joined');
      expect(registered).toContain('user:left');
    });
  });

  // ── joinBoard() ───────────────────────────────────────────────────────────

  describe('joinBoard()', () => {
    it('emits user:join when socket is connected', () => {
      mockSocket.connected = true;

      service.joinBoard();

      expect(mockSocket.emit).toHaveBeenCalledWith('user:join');
    });

    it('does not emit user:join when socket is not connected', () => {
      mockSocket.connected = false;

      service.joinBoard();

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  // ── connect event ─────────────────────────────────────────────────────────

  describe('connect event', () => {
    it('calls joinBoard() on initial connect', () => {
      mockSocket.connected = true;

      getHandler('connect')();

      expect(mockSocket.emit).toHaveBeenCalledWith('user:join');
    });

    it('re-calls joinBoard() on every subsequent connect — covers reconnect re-seed', () => {
      mockSocket.connected = true;

      getHandler('connect')();
      getHandler('connect')();

      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
      expect(mockSocket.emit).toHaveBeenNthCalledWith(1, 'user:join');
      expect(mockSocket.emit).toHaveBeenNthCalledWith(2, 'user:join');
    });

    it('does not emit user:join when socket.connected is false at fire time', () => {
      mockSocket.connected = false;

      getHandler('connect')();

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  // ── Observables ───────────────────────────────────────────────────────────

  describe('drawAction$', () => {
    it('emits the draw action pushed by the server', async () => {
      const action: WireDrawAction = {
        type: 'stroke',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.2 }],
        color: '#000',
        lineWidth: 2,
        userId: 'u1',
        seq: 1,
      };

      const received = firstValueFrom(service.drawAction$);
      getHandler('draw:action')(action);

      expect(await received).toEqual(action);
    });
  });

  describe('cursorMove$', () => {
    it('emits the cursor event pushed by the server', async () => {
      const cursor: CursorEvent = { x: 0.5, y: 0.3, userId: 'u2' };

      const received = firstValueFrom(service.cursorMove$);
      getHandler('draw:cursor')(cursor);

      expect(await received).toEqual(cursor);
    });
  });

  describe('boardState$', () => {
    it('emits the board state pushed by the server', async () => {
      const state: BoardState = { seq: 5, log: [] };

      const received = firstValueFrom(service.boardState$);
      getHandler('board:state')(state);

      expect(await received).toEqual(state);
    });
  });

  describe('userJoined$', () => {
    it('emits the userId of the newly joined peer', async () => {
      const received = firstValueFrom(service.userJoined$);
      getHandler('user:joined')('peer-abc');

      expect(await received).toBe('peer-abc');
    });
  });

  describe('userLeft$', () => {
    it('emits the userId of the departing peer', async () => {
      const received = firstValueFrom(service.userLeft$);
      getHandler('user:left')('peer-xyz');

      expect(await received).toBe('peer-xyz');
    });
  });

  // ── emitAction() ──────────────────────────────────────────────────────────

  describe('emitAction()', () => {
    it('is a cold Observable — does not emit to socket until subscribed', () => {
      const payload: DrawEventPayload = { type: 'clear', strokeId: 's3' };

      service.emitAction(payload); // not subscribed

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('emits draw:action to the socket with the given payload on subscribe', () => {
      const payload: DrawEventPayload = { type: 'stroke', strokeId: 's1', points: [{ x: 0.1, y: 0.2 }], color: '#000', lineWidth: 2 };
      mockSocket.emit.mockImplementation(
        (_ev: string, _p: unknown, ack: (r: unknown) => void) => ack({ seq: 1 }),
      );

      service.emitAction(payload).subscribe();

      expect(mockSocket.emit).toHaveBeenCalledWith('draw:action', payload, expect.any(Function));
    });

    it('resolves the Observable with the server-assigned ack (seq number)', async () => {
      const payload: DrawEventPayload = { type: 'stroke', strokeId: 's2', points: [{ x: 0.5, y: 0.5 }], color: '#000', lineWidth: 2 };
      const ackResponse = { seq: 42 };
      mockSocket.emit.mockImplementation(
        (_ev: string, _p: unknown, ack: (r: unknown) => void) => ack(ackResponse),
      );

      const result = await firstValueFrom(service.emitAction(payload));

      expect(result).toEqual(ackResponse);
    });
  });

  // ── emitCursor() ──────────────────────────────────────────────────────────

  describe('emitCursor()', () => {
    it('emits draw:cursor with the given payload', () => {
      const payload: CursorPayload = { x: 0.25, y: 0.75 };

      service.emitCursor(payload);

      expect(mockSocket.emit).toHaveBeenCalledWith('draw:cursor', payload);
    });
  });

  // ── ngOnDestroy() ─────────────────────────────────────────────────────────

  describe('ngOnDestroy()', () => {
    it('disconnects the socket', () => {
      service.ngOnDestroy();

      expect(mockSocket.disconnect).toHaveBeenCalledOnce();
    });
  });
});
