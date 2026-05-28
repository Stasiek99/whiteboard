"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const PORT = process.env['PORT'] ?? 3000;
const CLIENT_ORIGIN = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:4200';
const { httpServer } = (0, app_1.createApp)(CLIENT_ORIGIN);
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
