import { createApp } from './app';

const PORT = process.env['PORT'] ?? 3000;
const CLIENT_ORIGIN = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:4200';

const { httpServer } = createApp(CLIENT_ORIGIN);

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
