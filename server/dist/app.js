"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
function createApp(clientOrigin = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:4200', { logCap = 500 } = {}) {
    const boards = new Map();
    function getBoard(boardId) {
        if (!boards.has(boardId)) {
            boards.set(boardId, { seq: 0, log: [] });
        }
        return boards.get(boardId);
    }
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({ origin: clientOrigin }));
    app.use(express_1.default.json());
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });
    const httpServer = (0, http_1.createServer)(app);
    const io = new socket_io_1.Server(httpServer, { cors: { origin: clientOrigin, methods: ['GET', 'POST'] } });
    io.on('connection', (socket) => {
        const boardId = typeof socket.handshake.query['boardId'] === 'string'
            ? socket.handshake.query['boardId']
            : 'main';
        socket.data.userId = socket.id;
        socket.data.boardId = boardId;
        socket.join(boardId);
        socket.to(boardId).emit('user_joined', socket.id);
        socket.on('draw:action', (payload, ack) => {
            const board = getBoard(boardId);
            const seq = ++board.seq;
            const action = { ...payload, userId: socket.id, seq };
            board.log.push(action);
            if (board.log.length > logCap)
                board.log.shift();
            socket.to(boardId).emit('draw:action', action);
            ack({ seq });
        });
        socket.on('disconnect', () => {
            socket.to(boardId).emit('user_left', socket.id);
        });
    });
    return { app, httpServer, io, boards };
}
