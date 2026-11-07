import express from 'express';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { randomBytes, webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { keyText, validProfile, MAX_SIGNAL, type Profile } from '../shared/protocol.ts';

const app = express();
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        connectSrc: ["'self'", 'https:', 'ws:', 'wss:'],
        frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use((req, res, next) => {
  if (req.headers.origin && process.env.ALLOWED_ORIGINS?.split(',').includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
});
app.get('/health', (_, res) => res.json({ ok: true, service: 'wind-signaling' }));
app.get('/config', (_, res) => {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  // TURN REST credentials are temporary; never ship a static TURN password in a client bundle.
  if (process.env.TURN_URLS && process.env.TURN_SECRET) {
    import('node:crypto').then(({ createHmac }) => {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:wind`;
      const credential = createHmac('sha1', process.env.TURN_SECRET!)
        .update(username)
        .digest('base64');
      iceServers.push({ urls: process.env.TURN_URLS!.split(','), username, credential });
      res.json({ iceServers });
    });
  } else res.json({ iceServers });
});
app.use(express.static(resolve('dist'), { index: 'index.html' }));
app.get('/{*path}', (_, res) => res.sendFile(resolve('dist/index.html')));
const server = createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_SIGNAL,
  perMessageDeflate: false,
});
const clients = new Map<string, { ws: WebSocket; profile: Profile; watching: Set<string> }>();
const send = (ws: WebSocket, data: unknown) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
};
const origins = process.env.ALLOWED_ORIGINS?.split(',');
const ipCounts = new Map<string, number>();
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const sameHost =
    origin &&
    (() => {
      try {
        return new URL(origin).host === req.headers.host;
      } catch {
        return false;
      }
    })();
  const localDev =
    process.env.NODE_ENV !== 'production' &&
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);
  const ip = req.socket.remoteAddress || 'unknown';
  if (
    req.url !== '/signal' ||
    !origin ||
    !(sameHost || localDev || origins?.includes(origin)) ||
    (ipCounts.get(ip) || 0) >= 30
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.once('close', () => {
      const count = (ipCounts.get(ip) || 1) - 1;
      if (count) ipCounts.set(ip, count);
      else ipCounts.delete(ip);
    });
    wss.emit('connection', ws);
  });
});
wss.on('connection', (ws) => {
  const challenge = randomBytes(32).toString('base64url');
  let userId: string | undefined;
  let authenticating = false;
  let budget = 100,
    reset = Date.now();
  const authTimeout = setTimeout(() => ws.close(4001, 'Authentication timed out'), 15000);
  send(ws, { type: 'challenge', challenge });
  ws.on('message', async (raw) => {
    if (Date.now() - reset > 10000) {
      budget = 100;
      reset = Date.now();
    }
    if (--budget < 0) return ws.close(4008, 'Too many requests');
    try {
      const m = JSON.parse(raw.toString());
      if (!userId) {
        if (
          authenticating ||
          m.type !== 'register' ||
          !validProfile(m.profile) ||
          typeof m.signature !== 'string'
        )
          return ws.close(4003, 'Invalid identity');
        authenticating = true;
        const p: Profile = m.profile;
        const hash = await webcrypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(keyText(p.key)),
        );
        const id = Buffer.from(hash).toString('hex').slice(0, 24);
        const key = await webcrypto.subtle.importKey(
          'jwk',
          p.key,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        );
        const verified = await webcrypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          Buffer.from(m.signature, 'base64url'),
          new TextEncoder().encode(challenge),
        );
        if (id !== p.id || !verified) return ws.close(4003, 'Identity proof failed');
        if (ws.readyState !== WebSocket.OPEN) return;
        const previous = clients.get(id);
        if (previous) previous.ws.close(4009, 'This identity opened in another tab');
        userId = id;
        clearTimeout(authTimeout);
        clients.set(id, { ws, profile: p, watching: new Set() });
        send(ws, { type: 'ready' });
        for (const c of clients.values())
          if (c.watching.has(id)) send(c.ws, { type: 'presence', id, online: true });
        return;
      }
      if (m.type === 'watch' && Array.isArray(m.ids)) {
        const c = clients.get(userId)!;
        c.watching = new Set(
          m.ids
            .filter((id: unknown) => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id))
            .slice(0, 200),
        );
        for (const id of c.watching) send(ws, { type: 'presence', id, online: clients.has(id) });
      } else if (
        m.type === 'profile' &&
        validProfile(m.profile) &&
        m.profile.id === userId &&
        keyText(m.profile.key) === keyText(clients.get(userId)!.profile.key)
      ) {
        clients.get(userId)!.profile = m.profile;
      } else if (
        m.type === 'signal' &&
        m.signal?.from === userId &&
        typeof m.signal.to === 'string'
      ) {
        const target = clients.get(m.signal.to);
        if (target)
          send(target.ws, {
            type: 'signal',
            profile: clients.get(userId)!.profile,
            signal: m.signal,
          });
        else send(ws, { type: 'unavailable', id: m.signal.to });
      }
    } catch {
      ws.close(4003, 'Invalid message');
    }
  });
  ws.on('error', () => {});
  ws.on('pong', () => {
    (ws as WebSocket & { alive: boolean }).alive = true;
  });
  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (userId && clients.get(userId)?.ws === ws) {
      clients.delete(userId);
      for (const c of clients.values())
        if (c.watching.has(userId)) send(c.ws, { type: 'presence', id: userId, online: false });
    }
  });
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const client = ws as WebSocket & { alive?: boolean };
    if (client.alive === false) client.terminate();
    else {
      client.alive = false;
      client.ping();
    }
  }
}, 30000);
server.on('close', () => clearInterval(heartbeat));
const port = Number(process.env.PORT || 3001);
server.listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(`Wind listening on http://${process.env.HOST || '127.0.0.1'}:${port}`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    for (const ws of wss.clients) ws.close(1001, 'Server restarting');
    wss.close();
    server.close();
  });
