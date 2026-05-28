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
  { logCap = 500 }: { logCap?: number } = {},
) {
  const boards = new Map<string, BoardState>();
  const cursors = new Map<string, Map<string, CursorEvent>>();

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

  const app = express();
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const httpServer = createServer(app);

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    { cors: { origin: clientOrigin, methods: ['GET', 'POST'] } },
  );

  io.on('connection', (socket) => {
    const boardId =
      typeof socket.handshake.query['boardId'] === 'string'
        ? socket.handshake.query['boardId']
        : 'main';

    socket.data.userId = socket.id;
    socket.data.boardId = boardId;

    socket.join(boardId);

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
    });
  });

  return { app, httpServer, io, boards, cursors };
}
