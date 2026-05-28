import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import type { DrawAction, DrawActionAck, DrawEventPayload } from '../types';

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
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }

  // ── presence events ──────────────────────────────────────────────────────

  it('emits user_joined to existing clients when a new socket connects', async () => {
    const first = await connect();
    const joinedPromise = waitFor<string>(first, 'user_joined');

    const second = await connect();
    const joinedId = await joinedPromise;

    expect(joinedId).toBe(second.id);
  });

  it('emits user_left to remaining clients when a socket disconnects', async () => {
    const stayer = await connect();
    const leaver = await connect();

    const leftPromise = waitFor<string>(stayer, 'user_left');
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

  it('does not emit user_joined to clients on a different board', async () => {
    const existing = await connect('board-a');
    const outsider = await connect('board-b');

    let outsiderGotJoined = false;
    outsider.on('user_joined', () => {
      outsiderGotJoined = true;
    });

    const sameBoardJoined = waitFor<string>(existing, 'user_joined');
    await connect('board-a');
    await sameBoardJoined;
    await new Promise((r) => setTimeout(r, 80));

    expect(outsiderGotJoined).toBe(false);
  });

  it('does not emit user_left to clients on a different board', async () => {
    const stayer = await connect('board-a');
    const outsider = await connect('board-b');
    const leaver = await connect('board-a');

    let outsiderGotLeft = false;
    outsider.on('user_left', () => {
      outsiderGotLeft = true;
    });

    const sameBoardLeft = waitFor<string>(stayer, 'user_left');
    leaver.disconnect();
    await sameBoardLeft;
    await new Promise((r) => setTimeout(r, 80));

    expect(outsiderGotLeft).toBe(false);
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
});
