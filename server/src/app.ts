import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './types';

export function createApp(clientOrigin = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:4200') {
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
    socket.to(boardId).emit('user_joined', socket.id);

    socket.on('draw', (event) => {
      socket.to(boardId).emit('draw', { ...event, userId: socket.id });
    });

    socket.on('disconnect', () => {
      socket.to(boardId).emit('user_left', socket.id);
    });
  });

  return { app, httpServer, io };
}
