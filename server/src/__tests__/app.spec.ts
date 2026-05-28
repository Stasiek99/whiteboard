import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import type { BoardState, DrawAction, DrawActionAck, DrawEventPayload, CursorEvent, CursorPayload } from '../types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function waitFor<T>(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}" event`)),
      timeoutMs,
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function sendAction(socket: ClientSocket, payload: DrawEventPayload): Promise<DrawActionAck> {
  return new Promise<DrawActionAck>((resolve) => {
    socket.emit('draw:action', payload, resolve);
  });
}

const basePayload: DrawEventPayload = {
  type: 'stroke_move',
  strokeId: 's1',
  point: { x: 10, y: 20 },
  color: '#000000',
  lineWidth: 2,
};

// ─── HTTP routes ─────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const { app } = createApp('*');
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// ─── Socket.io ───────────────────────────────────────────────────────────────

describe('Socket.io', () => {
  let port: number;
  let teardown: () => Promise<void>;
  let clients: ClientSocket[];

  beforeEach(async () => {
    const { httpServer, io } = createApp('*');
    clients = [];

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    teardown = () =>
      new Promise<void>((resolve) => {
        clients.forEach((c) => c.disconnect());
        io.close();
        httpServer.close(() => resolve());
      });
  });

  afterEach(() => teardown());

  function connect(boardId = 'main'): Promise<ClientSocket> {
    return new Promise<ClientSocket>((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        query: { boardId },
        transports: ['websocket'],
      });
      clients.push(client);
      client.once('connect', () => {
        // Resolve only after board:state is consumed so the socket is clean
        // for any board:state listeners the test may register afterwards.
        client.once('board:state', () => resolve(client));
        client.emit('user:join');
      });
      client.once('connect_error', reject);
    });
  }

  /** Creates a socket and connects it without emitting user:join, so tests
   *  can register board:state listeners before the server responds. */
  function connectRaw(boardId = 'main'): Promise<ClientSocket> {
    return new Promise<ClientSocket>((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        query: { boardId },
        transports: ['websocket'],
      });
      clients.push(client);
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }

  // ── board:state on join ──────────────────────────────────────────────────

  it('emits board:state to the joining socket in response to user:join', async () => {
    const socket = await connectRaw();
    const statePromise = waitFor<BoardState>(socket, 'board:state');
    socket.emit('user:join');
    const state = await statePromise;

    expect(state).toEqual({ seq: 0, log: [] });
  });

  it('board:state includes existing log entries when joining mid-session', async () => {
    const first = await connect();
    await sendAction(first, basePayload);
    await sendAction(first, basePayload);

    const second = await connectRaw();
    const statePromise = waitFor<BoardState>(second, 'board:state');
    second.emit('user:join');
    const state = await statePromise;

    expect(state.log).toHaveLength(2);
    expect(state.seq).toBe(2);
  });

  it('does not send board:state to existing clients when a new socket joins', async () => {
    const first = await connect();
    let firstGotState = false;
    first.on('board:state', () => { firstGotState = true; });

    const second = await connectRaw();
    const secondStatePromise = waitFor<BoardState>(second, 'board:state');
    second.emit('user:join');
    await secondStatePromise;
    await new Promise((r) => setTimeout(r, 80));

    expect(firstGotState).toBe(false);
  });

  // ── presence events ──────────────────────────────────────────────────────

  it('emits user:joined to existing clients when a new socket connects', async () => {
    const first = await connect();
    const joinedPromise = waitFor<string>(first, 'user:joined');

    const second = await connect();
    const joinedId = await joinedPromise;

    expect(joinedId).toBe(second.id);
  });

  it('emits user:left to remaining clients when a socket disconnects', async () => {
    const stayer = await connect();
    const leaver = await connect();

    const leftPromise = waitFor<string>(stayer, 'user:left');
    const leaverId = leaver.id!;

    leaver.disconnect();
    const leftId = await leftPromise;

    expect(leftId).toBe(leaverId);
  });

  // ── draw:action relay ────────────────────────────────────────────────────

  it('broadcasts draw:action to all other connected clients', async () => {
    const sender = await connect();
    const receiver = await connect();

    const receivedPromise = waitFor<DrawAction>(receiver, 'draw:action');
    await sendAction(sender, basePayload);
    const received = await receivedPromise;

    expect(received.strokeId).toBe(basePayload.strokeId);
    expect(received.point).toEqual(basePayload.point);
    expect(received.color).toBe(basePayload.color);
    expect(received.lineWidth).toBe(basePayload.lineWidth);
  });

  it('stamps the server-assigned socket.id as userId on forwarded draw:action', async () => {
    const sender = await connect();
    const receiver = await connect();

    const receivedPromise = waitFor<DrawAction>(receiver, 'draw:action');
    await sendAction(sender, basePayload);
    const received = await receivedPromise;

    expect(received.userId).toBe(sender.id);
  });

  it('does not echo draw:action back to the sender', async () => {
    const sender = await connect();
    const receiver = await connect();

    let senderGotAction = false;
    sender.on('draw:action', () => {
      senderGotAction = true;
    });

    const receiverConfirmed = waitFor<DrawAction>(receiver, 'draw:action');
    await sendAction(sender, basePayload);
    await receiverConfirmed;
    await new Promise((r) => setTimeout(r, 80));

    expect(senderGotAction).toBe(false);
  });

  // ── ack and seq ──────────────────────────────────────────────────────────

  it('acknowledges draw:action with a positive seq number', async () => {
    const client = await connect();

    const ack = await sendAction(client, basePayload);

    expect(typeof ack.seq).toBe('number');
    expect(ack.seq).toBeGreaterThan(0);
  });

  it('increments seq monotonically within a board', async () => {
    const client = await connect();

    const ack1 = await sendAction(client, basePayload);
    const ack2 = await sendAction(client, basePayload);
    const ack3 = await sendAction(client, basePayload);

    expect(ack1.seq).toBe(1);
    expect(ack2.seq).toBe(2);
    expect(ack3.seq).toBe(3);
  });

  it('maintains independent seq counters per board', async () => {
    const clientA = await connect('board-a');
    const clientB = await connect('board-b');

    const ackA = await sendAction(clientA, basePayload);
    const ackB = await sendAction(clientB, basePayload);

    expect(ackA.seq).toBe(1);
    expect(ackB.seq).toBe(1);
  });

  it('includes seq in the action broadcast to peers', async () => {
    const sender = await connect();
    const receiver = await connect();

    const receivedPromise = waitFor<DrawAction>(receiver, 'draw:action');
    const ack = await sendAction(sender, basePayload);
    const received = await receivedPromise;

    expect(received.seq).toBe(ack.seq);
  });

  // ── room isolation ───────────────────────────────────────────────────────

  it('does not deliver draw:action events to clients on a different board', async () => {
    const sender = await connect('board-a');
    const sameBoard = await connect('board-a');
    const otherBoard = await connect('board-b');

    let otherGotAction = false;
    otherBoard.on('draw:action', () => {
      otherGotAction = true;
    });

    const sameBoardConfirmed = waitFor<DrawAction>(sameBoard, 'draw:action');
    await sendAction(sender, basePayload);
    await sameBoardConfirmed;
    await new Promise((r) => setTimeout(r, 80));

    expect(otherGotAction).toBe(false);
  });

  it('does not emit user:joined to clients on a different board', async () => {
    const existing = await connect('board-a');
    const outsider = await connect('board-b');

    let outsiderGotJoined = false;
    outsider.on('user:joined', () => {
      outsiderGotJoined = true;
    });

    const sameBoardJoined = waitFor<string>(existing, 'user:joined');
    await connect('board-a');
    await sameBoardJoined;
    await new Promise((r) => setTimeout(r, 80));

    expect(outsiderGotJoined).toBe(false);
  });

  it('does not emit user:left to clients on a different board', async () => {
    const stayer = await connect('board-a');
    const outsider = await connect('board-b');
    const leaver = await connect('board-a');

    let outsiderGotLeft = false;
    outsider.on('user:left', () => {
      outsiderGotLeft = true;
    });

    const sameBoardLeft = waitFor<string>(stayer, 'user:left');
    leaver.disconnect();
    await sameBoardLeft;
    await new Promise((r) => setTimeout(r, 80));

    expect(outsiderGotLeft).toBe(false);
  });

  // ── draw:cursor relay ────────────────────────────────────────────────────

  it('broadcasts draw:cursor to other clients in the same room', async () => {
    const sender = await connect();
    const receiver = await connect();

    const receivedPromise = waitFor<CursorEvent>(receiver, 'draw:cursor');

    sender.emit('draw:cursor', { x: 42, y: 99 } satisfies CursorPayload);

    const received = await receivedPromise;

    expect(received.x).toBe(42);
    expect(received.y).toBe(99);
  });

  it('stamps server-assigned socket.id as userId on draw:cursor', async () => {
    const sender = await connect();
    const receiver = await connect();

    const receivedPromise = waitFor<CursorEvent>(receiver, 'draw:cursor');

    sender.emit('draw:cursor', { x: 0, y: 0 } satisfies CursorPayload);

    const received = await receivedPromise;

    expect(received.userId).toBe(sender.id);
  });

  it('does not echo draw:cursor back to the sender', async () => {
    const sender = await connect();
    const receiver = await connect();

    let senderGotCursor = false;
    sender.on('draw:cursor', () => {
      senderGotCursor = true;
    });

    const receiverConfirmed = waitFor<CursorEvent>(receiver, 'draw:cursor');
    sender.emit('draw:cursor', { x: 1, y: 1 } satisfies CursorPayload);
    await receiverConfirmed;
    await new Promise((r) => setTimeout(r, 80));

    expect(senderGotCursor).toBe(false);
  });

  it('does not deliver draw:cursor to clients on a different board', async () => {
    const sender = await connect('board-a');
    const sameBoard = await connect('board-a');
    const otherBoard = await connect('board-b');

    let otherGotCursor = false;
    otherBoard.on('draw:cursor', () => {
      otherGotCursor = true;
    });

    const sameBoardConfirmed = waitFor<CursorEvent>(sameBoard, 'draw:cursor');
    sender.emit('draw:cursor', { x: 5, y: 5 } satisfies CursorPayload);
    await sameBoardConfirmed;
    await new Promise((r) => setTimeout(r, 80));

    expect(otherGotCursor).toBe(false);
  });
});

// ─── action log ──────────────────────────────────────────────────────────────

describe('draw:action log', () => {
  const LOG_CAP = 3;
  const logClients: ClientSocket[] = [];

  afterEach(() => logClients.forEach((c) => c.disconnect()));

  async function makeLogServer() {
    const { httpServer, io, boards } = createApp('*', { logCap: LOG_CAP });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const port = (httpServer.address() as AddressInfo).port;

    function connectLog(boardId = 'main'): Promise<ClientSocket> {
      return new Promise<ClientSocket>((resolve, reject) => {
        const c = ioClient(`http://localhost:${port}`, {
          query: { boardId },
          transports: ['websocket'],
        });
        logClients.push(c);
        c.once('connect', () => resolve(c));
        c.once('connect_error', reject);
      });
    }

    async function close() {
      io.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    }

    return { boards, connectLog, close };
  }

  it('appends each action to the board log with seq stamped', async () => {
    const { boards, connectLog, close } = await makeLogServer();
    const client = await connectLog();

    await sendAction(client, basePayload);
    await sendAction(client, basePayload);

    const board = boards.get('main')!;
    expect(board.log).toHaveLength(2);
    expect(board.log[0].seq).toBe(1);
    expect(board.log[1].seq).toBe(2);

    await close();
  });

  it('caps the log at logCap and drops the oldest entry', async () => {
    const { boards, connectLog, close } = await makeLogServer();
    const client = await connectLog();

    for (let i = 0; i < LOG_CAP + 1; i++) {
      await sendAction(client, basePayload);
    }

    const board = boards.get('main')!;
    expect(board.log).toHaveLength(LOG_CAP);
    expect(board.log[0].seq).toBe(2);                      // seq=1 was evicted
    expect(board.log[LOG_CAP - 1].seq).toBe(LOG_CAP + 1);  // newest entry

    await close();
  });

  it('does not add draw:cursor events to the board log', async () => {
    const { boards, connectLog, close } = await makeLogServer();
    const sender = await connectLog();
    const receiver = await connectLog();

    const receivedPromise = waitFor<CursorEvent>(receiver, 'draw:cursor');
    sender.emit('draw:cursor', { x: 10, y: 20 } satisfies CursorPayload);
    await receivedPromise;

    expect(boards.get('main')?.log ?? []).toHaveLength(0);

    await close();
  });
});

// ─── cursor state ─────────────────────────────────────────────────────────────

describe('cursor state', () => {
  const cursorClients: ClientSocket[] = [];

  afterEach(() => cursorClients.forEach((c) => c.disconnect()));

  async function makeCursorServer() {
    const { httpServer, io, cursors } = createApp('*');
    await new Promise<void>((r) => httpServer.listen(0, r));
    const port = (httpServer.address() as AddressInfo).port;

    function connectCursor(boardId = 'main'): Promise<ClientSocket> {
      return new Promise<ClientSocket>((resolve, reject) => {
        const c = ioClient(`http://localhost:${port}`, {
          query: { boardId },
          transports: ['websocket'],
        });
        cursorClients.push(c);
        c.once('connect', () => resolve(c));
        c.once('connect_error', reject);
      });
    }

    async function close() {
      io.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    }

    return { cursors, connectCursor, close };
  }

  it('stores cursor position when draw:cursor is received', async () => {
    const { cursors, connectCursor, close } = await makeCursorServer();
    const sender = await connectCursor();
    const receiver = await connectCursor();

    const receivedPromise = waitFor<CursorEvent>(receiver, 'draw:cursor');
    sender.emit('draw:cursor', { x: 42, y: 99 } satisfies CursorPayload);
    await receivedPromise;

    const boardCursors = cursors.get('main')!;
    expect(boardCursors.get(sender.id!)).toMatchObject({ x: 42, y: 99, userId: sender.id });

    await close();
  });

  it('removes cursor entry when socket disconnects', async () => {
    const { cursors, connectCursor, close } = await makeCursorServer();
    const sender = await connectCursor();
    const receiver = await connectCursor();

    const receivedCursor = waitFor<CursorEvent>(receiver, 'draw:cursor');
    sender.emit('draw:cursor', { x: 1, y: 2 } satisfies CursorPayload);
    await receivedCursor;

    const senderId = sender.id!;
    expect(cursors.get('main')?.has(senderId)).toBe(true);

    const leftPromise = waitFor<string>(receiver, 'user:left');
    sender.disconnect();
    await leftPromise;

    expect(cursors.get('main')?.has(senderId)).toBe(false);

    await close();
  });

  it('does not retain cursor entries for clients that never moved', async () => {
    const { cursors, connectCursor, close } = await makeCursorServer();
    const client = await connectCursor();

    const clientId = client.id!;
    client.disconnect();
    await new Promise((r) => setTimeout(r, 80));

    expect(cursors.get('main')?.has(clientId)).toBeFalsy();

    await close();
  });
});

// ─── room cleanup ─────────────────────────────────────────────────────────────

describe('room cleanup', () => {
  const cleanupClients: ClientSocket[] = [];

  afterEach(() => cleanupClients.forEach((c) => c.disconnect()));

  const IDLE_MS = 80;

  async function makeCleanupServer() {
    const { httpServer, io, boards, cursors, roomTimers } = createApp('*', { roomIdleMs: IDLE_MS });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const port = (httpServer.address() as AddressInfo).port;

    function connectCleanup(boardId = 'main'): Promise<ClientSocket> {
      return new Promise<ClientSocket>((resolve, reject) => {
        const c = ioClient(`http://localhost:${port}`, {
          query: { boardId },
          transports: ['websocket'],
        });
        cleanupClients.push(c);
        c.once('connect', () => resolve(c));
        c.once('connect_error', reject);
      });
    }

    async function close() {
      io.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    }

    return { boards, cursors, roomTimers, connectCleanup, close };
  }

  it('deletes board log and cursors after idle timeout when room empties', async () => {
    const { boards, cursors, connectCleanup, close } = await makeCleanupServer();
    const client = await connectCleanup();

    await sendAction(client, basePayload);
    expect(boards.get('main')?.log).toHaveLength(1);

    client.disconnect();
    await new Promise((r) => setTimeout(r, IDLE_MS * 2));

    expect(boards.has('main')).toBe(false);
    expect(cursors.has('main')).toBe(false);

    await close();
  });

  it('cancels cleanup timer when a new client joins before timeout fires', async () => {
    const { boards, roomTimers, connectCleanup, close } = await makeCleanupServer();
    const first = await connectCleanup();

    await sendAction(first, basePayload);
    first.disconnect();

    // Timer is now scheduled — join before it fires
    await new Promise((r) => setTimeout(r, IDLE_MS / 2));
    expect(roomTimers.has('main')).toBe(true);

    const second = await connectCleanup();
    expect(roomTimers.has('main')).toBe(false);

    // Wait past where the original timer would have fired
    await new Promise((r) => setTimeout(r, IDLE_MS * 2));
    expect(boards.has('main')).toBe(true);

    second.disconnect();
    await close();
  });

  it('schedules a fresh timer when the room empties again after rejoining', async () => {
    const { boards, roomTimers, connectCleanup, close } = await makeCleanupServer();

    const first = await connectCleanup();
    first.disconnect();
    await new Promise((r) => setTimeout(r, IDLE_MS / 2));

    // Rejoin cancels first timer, leaving creates a second timer
    const second = await connectCleanup();
    second.disconnect();
    await new Promise((r) => setTimeout(r, IDLE_MS / 2));
    expect(roomTimers.has('main')).toBe(true);

    await new Promise((r) => setTimeout(r, IDLE_MS));
    expect(boards.has('main')).toBe(false);

    await close();
  });

  it('does not delete board while clients are still connected', async () => {
    const { boards, connectCleanup, close } = await makeCleanupServer();
    const first = await connectCleanup();
    const second = await connectCleanup();

    await sendAction(first, basePayload);
    first.disconnect();

    await new Promise((r) => setTimeout(r, IDLE_MS * 2));
    expect(boards.has('main')).toBe(true);

    second.disconnect();
    await close();
  });
});

// ─── Phase 3 integration scenarios ───────────────────────────────────────────

describe('Phase 3 — resilience', () => {
  const phase3Clients: ClientSocket[] = [];

  afterEach(() => phase3Clients.forEach((c) => { try { c.disconnect(); } catch { /* already gone */ } }));

  async function makeServer(opts: Parameters<typeof createApp>[1] = {}) {
    const { httpServer, io, boards } = createApp('*', opts);
    await new Promise<void>((r) => httpServer.listen(0, r));
    const port = (httpServer.address() as AddressInfo).port;

    function connectPhase3(boardId = 'main', extraOpts: Parameters<typeof ioClient>[1] = {}): Promise<ClientSocket> {
      return new Promise<ClientSocket>((resolve, reject) => {
        const c = ioClient(`http://localhost:${port}`, {
          query: { boardId },
          transports: ['websocket'],
          reconnection: false,
          ...extraOpts,
        });
        phase3Clients.push(c);
        c.once('connect', () => resolve(c));
        c.once('connect_error', reject);
      });
    }

    async function close() {
      io.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    }

    return { io, boards, connectPhase3, close };
  }

  // ── scenario 3: 600 events, default 500 cap ──────────────────────────────

  it('default 500-action cap is enforced when 600 events are sent', async () => {
    const { boards, connectPhase3, close } = await makeServer();
    const client = await connectPhase3();

    for (let i = 0; i < 600; i++) {
      await sendAction(client, { ...basePayload, strokeId: `s${i}` });
    }

    const board = boards.get('main')!;
    expect(board.log.length).toBe(500);
    expect(board.log[0].seq).toBe(101);           // first 100 evicted
    expect(board.log[499].seq).toBe(600);          // newest entry

    await close();
  });

  // ── scenario 4: abrupt disconnect → user:left ────────────────────────────

  it('broadcasts user:left when a connection is force-closed by the server', async () => {
    const { io, connectPhase3, close } = await makeServer({ pingTimeout: 300, pingInterval: 100 });

    const tab1 = await connectPhase3();
    const tab2 = await connectPhase3();
    const tab1Id = tab1.id!;

    const leftPromise = waitFor<string>(tab2, 'user:left', 1000);

    // Simulate the server side detecting a dead connection (equivalent to
    // the ping-timeout path) by force-closing the server-side socket.
    // The true DevTools → Offline path (pong suppression) exercises the
    // same user:left broadcast and is covered by manual E2E testing.
    const serverSocket = io.sockets.sockets.get(tab1Id);
    serverSocket?.disconnect(true);

    const leftId = await leftPromise;
    expect(leftId).toBe(tab1Id);

    expect(io.sockets.sockets.has(tab1Id)).toBe(false);

    await close();
  });

  // ── scenario 5: server shutdown → clients disconnect/reconnecting ─────────

  it('clients receive disconnect event when the server shuts down', async () => {
    const { io, connectPhase3, close } = await makeServer();

    const tab1 = await connectPhase3();
    const tab2 = await connectPhase3();

    const d1 = waitFor<string>(tab1, 'disconnect', 3000);
    const d2 = waitFor<string>(tab2, 'disconnect', 3000);

    // Shut down without waiting — clients should detect the dropped connection
    io.close();

    const [reason1, reason2] = await Promise.all([d1, d2]);
    expect(reason1).toMatch(/transport|server|close/i);
    expect(reason2).toMatch(/transport|server|close/i);

    await close();
  });
});
