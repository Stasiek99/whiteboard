import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  BoardState,
  CursorEvent,
  DrawAction,
} from './types';

export function createApp(
  clientOrigin = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:4200',
  {
    logCap = 500,
    roomIdleMs = 30 * 60 * 1000,
    pingTimeout = 20_000,
    pingInterval = 25_000,
  }: { logCap?: number; roomIdleMs?: number; pingTimeout?: number; pingInterval?: number } = {},
) {
  const boards = new Map<string, BoardState>();
  const cursors = new Map<string, Map<string, CursorEvent>>();
  const roomTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function getBoard(boardId: string): BoardState {
    if (!boards.has(boardId)) {
      boards.set(boardId, { seq: 0, log: [] });
    }
    return boards.get(boardId)!;
  }

  function getBoardCursors(boardId: string): Map<string, CursorEvent> {
    if (!cursors.has(boardId)) {
      cursors.set(boardId, new Map());
    }
    return cursors.get(boardId)!;
  }

  function cancelRoomTimer(boardId: string) {
    const t = roomTimers.get(boardId);
    if (t !== undefined) {
      clearTimeout(t);
      roomTimers.delete(boardId);
    }
  }

  function scheduleRoomCleanup(boardId: string) {
    cancelRoomTimer(boardId);
    roomTimers.set(
      boardId,
      setTimeout(() => {
        roomTimers.delete(boardId);
        if (!io.sockets.adapter.rooms.has(boardId)) {
          boards.delete(boardId);
          cursors.delete(boardId);
        }
      }, roomIdleMs),
    );
  }

  const app = express();
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const httpServer = createServer(app);

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    { cors: { origin: clientOrigin, methods: ['GET', 'POST'] }, pingTimeout, pingInterval },
  );

  io.on('connection', (socket) => {
    const boardId =
      typeof socket.handshake.query['boardId'] === 'string'
        ? socket.handshake.query['boardId']
        : 'main';

    socket.data.userId = socket.id;
    socket.data.boardId = boardId;

    socket.join(boardId);
    cancelRoomTimer(boardId);

    socket.on('user:join', () => {
      const board = getBoard(boardId);
      socket.emit('board:state', { seq: board.seq, log: board.log });
      socket.to(boardId).emit('user:joined', socket.id);
    });

    socket.on('draw:action', (payload, ack) => {
      const board = getBoard(boardId);
      const seq = ++board.seq;
      const action: DrawAction = { ...payload, userId: socket.id, seq };

      board.log.push(action);
      if (board.log.length > logCap) board.log.shift();

      socket.to(boardId).emit('draw:action', action);
      ack({ seq });
    });

    socket.on('draw:cursor', (payload) => {
      const cursor: CursorEvent = { ...payload, userId: socket.id };
      getBoardCursors(boardId).set(socket.id, cursor);
      socket.to(boardId).emit('draw:cursor', cursor);
    });

    socket.on('disconnect', () => {
      getBoardCursors(boardId).delete(socket.id);
      socket.to(boardId).emit('user:left', socket.id);
      if (!io.sockets.adapter.rooms.has(boardId)) {
        scheduleRoomCleanup(boardId);
      }
    });
  });

  return { app, httpServer, io, boards, cursors, roomTimers };
}
