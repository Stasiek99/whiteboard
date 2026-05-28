import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import type { DrawEvent } from '../types';

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

  // ── draw relay ───────────────────────────────────────────────────────────

  it('broadcasts draw event to all other connected clients', async () => {
    const sender = await connect();
    const receiver = await connect();

    const receivedPromise = waitFor<DrawEvent>(receiver, 'draw');

    sender.emit('draw', {
      type: 'stroke_move',
      strokeId: 'abc',
      point: { x: 10, y: 20 },
      color: '#ff0000',
      lineWidth: 3,
      userId: '',
    } satisfies DrawEvent);

    const received = await receivedPromise;

    expect(received.strokeId).toBe('abc');
    expect(received.point).toEqual({ x: 10, y: 20 });
    expect(received.color).toBe('#ff0000');
    expect(received.lineWidth).toBe(3);
  });

  it('stamps the server-assigned socket.id as userId on forwarded draw events', async () => {
    const sender = await connect();
    const receiver = await connect();

    const receivedPromise = waitFor<DrawEvent>(receiver, 'draw');

    sender.emit('draw', {
      type: 'stroke_start',
      strokeId: 's1',
      point: { x: 0, y: 0 },
      userId: 'client-supplied-id-should-be-ignored',
    } satisfies DrawEvent);

    const received = await receivedPromise;

    expect(received.userId).toBe(sender.id);
  });

  it('does not echo draw events back to the sender', async () => {
    const sender = await connect();
    const receiver = await connect();

    let senderGotDraw = false;
    sender.on('draw', () => {
      senderGotDraw = true;
    });

    const receiverConfirmed = waitFor<DrawEvent>(receiver, 'draw');

    sender.emit('draw', {
      type: 'stroke_move',
      strokeId: 'no-echo',
      point: { x: 1, y: 1 },
      userId: '',
    } satisfies DrawEvent);

    // Wait until receiver confirms the server processed and broadcast the event
    await receiverConfirmed;
    // Give any potential echo a moment to arrive
    await new Promise((r) => setTimeout(r, 80));

    expect(senderGotDraw).toBe(false);
  });

  // ── room isolation ───────────────────────────────────────────────────────

  it('does not deliver draw events to clients on a different board', async () => {
    const sender = await connect('board-a');
    const sameBoard = await connect('board-a');
    const otherBoard = await connect('board-b');

    let otherGotDraw = false;
    otherBoard.on('draw', () => {
      otherGotDraw = true;
    });

    const sameBoardConfirmed = waitFor<DrawEvent>(sameBoard, 'draw');

    sender.emit('draw', {
      type: 'stroke_move',
      strokeId: 'r1',
      point: { x: 5, y: 5 },
      userId: '',
    } satisfies DrawEvent);

    await sameBoardConfirmed;
    await new Promise((r) => setTimeout(r, 80));

    expect(otherGotDraw).toBe(false);
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
