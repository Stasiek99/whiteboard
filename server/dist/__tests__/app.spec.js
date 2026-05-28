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
function sendAction(socket, payload) {
    return new Promise((resolve) => {
        socket.emit('draw:action', payload, resolve);
    });
}
const basePayload = {
    type: 'stroke_move',
    strokeId: 's1',
    point: { x: 10, y: 20 },
    color: '#000000',
    lineWidth: 2,
};
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
    // ── draw:action relay ────────────────────────────────────────────────────
    (0, vitest_1.it)('broadcasts draw:action to all other connected clients', async () => {
        const sender = await connect();
        const receiver = await connect();
        const receivedPromise = waitFor(receiver, 'draw:action');
        await sendAction(sender, basePayload);
        const received = await receivedPromise;
        (0, vitest_1.expect)(received.strokeId).toBe(basePayload.strokeId);
        (0, vitest_1.expect)(received.point).toEqual(basePayload.point);
        (0, vitest_1.expect)(received.color).toBe(basePayload.color);
        (0, vitest_1.expect)(received.lineWidth).toBe(basePayload.lineWidth);
    });
    (0, vitest_1.it)('stamps the server-assigned socket.id as userId on forwarded draw:action', async () => {
        const sender = await connect();
        const receiver = await connect();
        const receivedPromise = waitFor(receiver, 'draw:action');
        await sendAction(sender, basePayload);
        const received = await receivedPromise;
        (0, vitest_1.expect)(received.userId).toBe(sender.id);
    });
    (0, vitest_1.it)('does not echo draw:action back to the sender', async () => {
        const sender = await connect();
        const receiver = await connect();
        let senderGotAction = false;
        sender.on('draw:action', () => {
            senderGotAction = true;
        });
        const receiverConfirmed = waitFor(receiver, 'draw:action');
        await sendAction(sender, basePayload);
        await receiverConfirmed;
        await new Promise((r) => setTimeout(r, 80));
        (0, vitest_1.expect)(senderGotAction).toBe(false);
    });
    // ── ack and seq ──────────────────────────────────────────────────────────
    (0, vitest_1.it)('acknowledges draw:action with a positive seq number', async () => {
        const client = await connect();
        const ack = await sendAction(client, basePayload);
        (0, vitest_1.expect)(typeof ack.seq).toBe('number');
        (0, vitest_1.expect)(ack.seq).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('increments seq monotonically within a board', async () => {
        const client = await connect();
        const ack1 = await sendAction(client, basePayload);
        const ack2 = await sendAction(client, basePayload);
        const ack3 = await sendAction(client, basePayload);
        (0, vitest_1.expect)(ack1.seq).toBe(1);
        (0, vitest_1.expect)(ack2.seq).toBe(2);
        (0, vitest_1.expect)(ack3.seq).toBe(3);
    });
    (0, vitest_1.it)('maintains independent seq counters per board', async () => {
        const clientA = await connect('board-a');
        const clientB = await connect('board-b');
        const ackA = await sendAction(clientA, basePayload);
        const ackB = await sendAction(clientB, basePayload);
        (0, vitest_1.expect)(ackA.seq).toBe(1);
        (0, vitest_1.expect)(ackB.seq).toBe(1);
    });
    (0, vitest_1.it)('includes seq in the action broadcast to peers', async () => {
        const sender = await connect();
        const receiver = await connect();
        const receivedPromise = waitFor(receiver, 'draw:action');
        const ack = await sendAction(sender, basePayload);
        const received = await receivedPromise;
        (0, vitest_1.expect)(received.seq).toBe(ack.seq);
    });
    // ── room isolation ───────────────────────────────────────────────────────
    (0, vitest_1.it)('does not deliver draw:action events to clients on a different board', async () => {
        const sender = await connect('board-a');
        const sameBoard = await connect('board-a');
        const otherBoard = await connect('board-b');
        let otherGotAction = false;
        otherBoard.on('draw:action', () => {
            otherGotAction = true;
        });
        const sameBoardConfirmed = waitFor(sameBoard, 'draw:action');
        await sendAction(sender, basePayload);
        await sameBoardConfirmed;
        await new Promise((r) => setTimeout(r, 80));
        (0, vitest_1.expect)(otherGotAction).toBe(false);
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
// ─── action log ──────────────────────────────────────────────────────────────
(0, vitest_1.describe)('draw:action log', () => {
    const LOG_CAP = 3;
    const logClients = [];
    (0, vitest_1.afterEach)(() => logClients.forEach((c) => c.disconnect()));
    async function makeLogServer() {
        const { httpServer, io, boards } = (0, app_1.createApp)('*', { logCap: LOG_CAP });
        await new Promise((r) => httpServer.listen(0, r));
        const port = httpServer.address().port;
        function connectLog(boardId = 'main') {
            return new Promise((resolve, reject) => {
                const c = (0, socket_io_client_1.io)(`http://localhost:${port}`, {
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
            await new Promise((r) => httpServer.close(() => r()));
        }
        return { boards, connectLog, close };
    }
    (0, vitest_1.it)('appends each action to the board log with seq stamped', async () => {
        const { boards, connectLog, close } = await makeLogServer();
        const client = await connectLog();
        await sendAction(client, basePayload);
        await sendAction(client, basePayload);
        const board = boards.get('main');
        (0, vitest_1.expect)(board.log).toHaveLength(2);
        (0, vitest_1.expect)(board.log[0].seq).toBe(1);
        (0, vitest_1.expect)(board.log[1].seq).toBe(2);
        await close();
    });
    (0, vitest_1.it)('caps the log at logCap and drops the oldest entry', async () => {
        const { boards, connectLog, close } = await makeLogServer();
        const client = await connectLog();
        for (let i = 0; i < LOG_CAP + 1; i++) {
            await sendAction(client, basePayload);
        }
        const board = boards.get('main');
        (0, vitest_1.expect)(board.log).toHaveLength(LOG_CAP);
        (0, vitest_1.expect)(board.log[0].seq).toBe(2); // seq=1 was evicted
        (0, vitest_1.expect)(board.log[LOG_CAP - 1].seq).toBe(LOG_CAP + 1); // newest entry
        await close();
    });
});
