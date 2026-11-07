import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { keyText, signalText, validProfile, type Profile } from '../shared/protocol.ts';
const origin = 'http://127.0.0.1:3107';
let server: ChildProcess;
before(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: '3107' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await Promise.race([
    once(server.stdout!, 'data'),
    once(server, 'exit').then(() => {
      throw new Error('Signaling server exited');
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Server startup timeout')), 10000).unref(),
    ),
  ]);
});
after(() => {
  server?.kill();
});
async function identity(name: string) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const key = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(keyText(key)));
  const profile: Profile = {
    id: Buffer.from(hash).toString('hex').slice(0, 24),
    name,
    bio: '',
    color: '#b9ef69',
    key,
  };
  return { pair, profile };
}
async function connection(name: string) {
  const who = await identity(name);
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/signal', { origin });
  const [data] = await once(ws, 'message');
  const challenge = JSON.parse(data.toString()).challenge;
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      who.pair.privateKey,
      new TextEncoder().encode(challenge),
    ),
  ).toString('base64url');
  const ready = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'register', profile: who.profile, signature }));
  assert.equal(JSON.parse((await ready)[0].toString()).type, 'ready');
  return { ...who, ws, signature };
}
test('profile validation rejects private key material and unsafe avatars', async () => {
  const { profile } = await identity('Alice');
  assert.equal(validProfile(profile), true);
  assert.equal(validProfile({ ...profile, key: { ...profile.key, d: 'secret' } }), false);
  assert.equal(validProfile({ ...profile, avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }), false);
  assert.equal(validProfile({ ...profile, name: 'x'.repeat(33) }), false);
});
test('signaling requires proof of the matching private key on every socket', async () => {
  const user = await connection('Alice');
  const replay = new WebSocket(origin.replace('http:', 'ws:') + '/signal', { origin });
  await once(replay, 'message');
  const closed = once(replay, 'close');
  replay.send(
    JSON.stringify({ type: 'register', profile: user.profile, signature: user.signature }),
  );
  assert.equal((await closed)[0], 4003);
  user.ws.close();
});
test('signaling routes only authenticated senders and does not relay spoofed identities', async () => {
  const alice = await connection('Alice'),
    bob = await connection('Bob');
  try {
    const relay = once(bob.ws, 'message');
    alice.ws.send(
      JSON.stringify({
        type: 'signal',
        signal: { from: alice.profile.id, to: bob.profile.id, body: { type: 'friend-request' } },
      }),
    );
    assert.equal(JSON.parse((await relay)[0].toString()).signal.from, alice.profile.id);
    let spoofed = false;
    bob.ws.on('message', () => {
      spoofed = true;
    });
    alice.ws.send(
      JSON.stringify({
        type: 'signal',
        signal: { from: bob.profile.id, to: bob.profile.id, body: { type: 'friend-request' } },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(spoofed, false);
  } finally {
    alice.ws.close();
    bob.ws.close();
  }
});
test('signed envelopes bind recipient, SDP and public profile; tampering fails verification', async () => {
  const alice = await identity('Alice');
  const signal = {
    id: 'one',
    from: alice.profile.id,
    to: 'bob',
    at: Date.now(),
    body: {
      type: 'data-offer',
      description: { type: 'offer', sdp: 'fingerprint:original' },
      profile: alice.profile,
    },
  };
  const data = new TextEncoder().encode(signalText(signal));
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    alice.pair.privateKey,
    data,
  );
  const check = (text: string) =>
    webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      alice.pair.publicKey,
      signature,
      new TextEncoder().encode(text),
    );
  assert.equal(await check(signalText(signal)), true);
  assert.equal(await check(signalText({ ...signal, to: 'mallory' })), false);
  assert.equal(
    await check(
      signalText({
        ...signal,
        body: { ...signal.body, description: { type: 'offer', sdp: 'fingerprint:attacker' } },
      }),
    ),
    false,
  );
  assert.equal(
    await check(
      signalText({
        ...signal,
        body: { ...signal.body, profile: { ...alice.profile, name: 'Mallory' } },
      }),
    ),
    false,
  );
});
test('HTTP health works and cross-origin websocket upgrades fail closed', async () => {
  assert.equal((await fetch(origin + '/health')).status, 200);
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/signal', {
    origin: 'https://untrusted.example',
  });
  ws.on('error', () => {});
  const [_, response] = await once(ws, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  ws.terminate();
});
