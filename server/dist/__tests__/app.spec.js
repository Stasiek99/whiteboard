"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const socket_io_client_1 = require("socket.io-client");
const app_1 = require("../app");
// ─── helpers ─────────────────────────────────────────────────────────────────
function waitFor(socket, event, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}" event`)), timeoutMs);
        socket.once(event, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}
// ─── HTTP routes ─────────────────────────────────────────────────────────────
(0, vitest_1.describe)('GET /health', () => {
    (0, vitest_1.it)('returns 200 with { status: "ok" }', async () => {
        const { app } = (0, app_1.createApp)('*');
        const res = await (0, supertest_1.default)(app).get('/health');
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body).toEqual({ status: 'ok' });
    });
});
// ─── Socket.io ───────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Socket.io', () => {
    let port;
    let teardown;
    let clients;
    (0, vitest_1.beforeEach)(async () => {
        const { httpServer, io } = (0, app_1.createApp)('*');
        clients = [];
        await new Promise((resolve) => httpServer.listen(0, resolve));
        port = httpServer.address().port;
        teardown = () => new Promise((resolve) => {
            clients.forEach((c) => c.disconnect());
            io.close();
            httpServer.close(() => resolve());
        });
    });
    (0, vitest_1.afterEach)(() => teardown());
    function connect(boardId = 'main') {
        return new Promise((resolve, reject) => {
            const client = (0, socket_io_client_1.io)(`http://localhost:${port}`, {
                query: { boardId },
                transports: ['websocket'],
            });
            clients.push(client);
            client.once('connect', () => resolve(client));
            client.once('connect_error', reject);
        });
    }
    // ── presence events ──────────────────────────────────────────────────────
    (0, vitest_1.it)('emits user_joined to existing clients when a new socket connects', async () => {
        const first = await connect();
        const joinedPromise = waitFor(first, 'user_joined');
        const second = await connect();
        const joinedId = await joinedPromise;
        (0, vitest_1.expect)(joinedId).toBe(second.id);
    });
    (0, vitest_1.it)('emits user_left to remaining clients when a socket disconnects', async () => {
        const stayer = await connect();
        const leaver = await connect();
        const leftPromise = waitFor(stayer, 'user_left');
        const leaverId = leaver.id;
        leaver.disconnect();
        const leftId = await leftPromise;
        (0, vitest_1.expect)(leftId).toBe(leaverId);
    });
    // ── draw relay ───────────────────────────────────────────────────────────
    (0, vitest_1.it)('broadcasts draw event to all other connected clients', async () => {
        const sender = await connect();
        const receiver = await connect();
        const receivedPromise = waitFor(receiver, 'draw');
        sender.emit('draw', {
            type: 'stroke_move',
            strokeId: 'abc',
            point: { x: 10, y: 20 },
            color: '#ff0000',
            lineWidth: 3,
            userId: '',
        });
        const received = await receivedPromise;
        (0, vitest_1.expect)(received.strokeId).toBe('abc');
        (0, vitest_1.expect)(received.point).toEqual({ x: 10, y: 20 });
        (0, vitest_1.expect)(received.color).toBe('#ff0000');
        (0, vitest_1.expect)(received.lineWidth).toBe(3);
    });
    (0, vitest_1.it)('stamps the server-assigned socket.id as userId on forwarded draw events', async () => {
        const sender = await connect();
        const receiver = await connect();
        const receivedPromise = waitFor(receiver, 'draw');
        sender.emit('draw', {
            type: 'stroke_start',
            strokeId: 's1',
            point: { x: 0, y: 0 },
            userId: 'client-supplied-id-should-be-ignored',
        });
        const received = await receivedPromise;
        (0, vitest_1.expect)(received.userId).toBe(sender.id);
    });
    (0, vitest_1.it)('does not echo draw events back to the sender', async () => {
        const sender = await connect();
        const receiver = await connect();
        let senderGotDraw = false;
        sender.on('draw', () => {
            senderGotDraw = true;
        });
        const receiverConfirmed = waitFor(receiver, 'draw');
        sender.emit('draw', {
            type: 'stroke_move',
            strokeId: 'no-echo',
            point: { x: 1, y: 1 },
            userId: '',
        });
        // Wait until receiver confirms the server processed and broadcast the event
        await receiverConfirmed;
        // Give any potential echo a moment to arrive
        await new Promise((r) => setTimeout(r, 80));
        (0, vitest_1.expect)(senderGotDraw).toBe(false);
    });
    // ── room isolation ───────────────────────────────────────────────────────
    (0, vitest_1.it)('does not deliver draw events to clients on a different board', async () => {
        const sender = await connect('board-a');
        const sameBoard = await connect('board-a');
        const otherBoard = await connect('board-b');
        let otherGotDraw = false;
        otherBoard.on('draw', () => {
            otherGotDraw = true;
        });
        const sameBoardConfirmed = waitFor(sameBoard, 'draw');
        sender.emit('draw', {
            type: 'stroke_move',
            strokeId: 'r1',
            point: { x: 5, y: 5 },
            userId: '',
        });
        await sameBoardConfirmed;
        await new Promise((r) => setTimeout(r, 80));
        (0, vitest_1.expect)(otherGotDraw).toBe(false);
    });
    (0, vitest_1.it)('does not emit user_joined to clients on a different board', async () => {
        const existing = await connect('board-a');
        const outsider = await connect('board-b');
        let outsiderGotJoined = false;
        outsider.on('user_joined', () => {
            outsiderGotJoined = true;
        });
        const sameBoardJoined = waitFor(existing, 'user_joined');
        await connect('board-a');
        await sameBoardJoined;
        await new Promise((r) => setTimeout(r, 80));
        (0, vitest_1.expect)(outsiderGotJoined).toBe(false);
    });
    (0, vitest_1.it)('does not emit user_left to clients on a different board', async () => {
        const stayer = await connect('board-a');
        const outsider = await connect('board-b');
        const leaver = await connect('board-a');
        let outsiderGotLeft = false;
        outsider.on('user_left', () => {
            outsiderGotLeft = true;
        });
        const sameBoardLeft = waitFor(stayer, 'user_left');
        leaver.disconnect();
        await sameBoardLeft;
        await new Promise((r) => setTimeout(r, 80));
        (0, vitest_1.expect)(outsiderGotLeft).toBe(false);
    });
});
