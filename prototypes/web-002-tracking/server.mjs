import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const certFile = process.env.HTTPS_CERT_FILE;
const keyFile = process.env.HTTPS_KEY_FILE;

function serve(_request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(readFileSync(`${root}/index.html`, 'utf8'));
}

const server =
  certFile && keyFile
    ? createHttpsServer(
        { cert: readFileSync(certFile), key: readFileSync(keyFile) },
        serve,
      )
    : createHttpServer(serve);

const io = new Server(server, {
  serveClient: true,
  transports: ['websocket', 'polling'],
});

const snapshots = new Map();

io.on('connection', (socket) => {
  const driverId = String(socket.handshake.auth.driverId ?? 'prototype-driver');

  socket.on('tracking:resume', (acknowledge) => {
    socket.join(`driver:${driverId}`);
    acknowledge?.({ snapshot: snapshots.get(driverId) ?? null });
  });

  socket.on('location:update', (sample, acknowledge) => {
    const receivedAt = new Date().toISOString();
    const previous = snapshots.get(driverId);
    const accepted =
      Number.isInteger(sample?.sequence) &&
      (!previous || sample.sequence > previous.sequence) &&
      Number.isFinite(sample?.latitude) &&
      Number.isFinite(sample?.longitude) &&
      Number.isFinite(sample?.accuracy) &&
      Date.parse(sample?.recordedAt) > Date.now() - 120_000;

    if (accepted) snapshots.set(driverId, { ...sample, receivedAt });
    acknowledge?.({ accepted, receivedAt, reason: accepted ? null : 'invalid-or-stale-sequence' });
  });

  socket.on('prototype:disconnect-transport', () => socket.disconnect(true));
});

server.listen(port, '0.0.0.0', () => {
  const protocol = certFile && keyFile ? 'https' : 'http';
  console.log(`WEB-002 prototype listening on ${protocol}://localhost:${port}`);
  if (protocol === 'http') {
    console.log('HTTP geolocation works on localhost only; use trusted HTTPS for a phone.');
  }
});
