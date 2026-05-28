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
