import { openDB } from 'idb';
import { keyText, validProfile, type Profile, type Signal, signalText } from '../shared/protocol';

export const db = openDB('wind-v1', 1, {
  upgrade(database) {
    database.createObjectStore('settings');
    database.createObjectStore('contacts', { keyPath: 'id' });
    const messages = database.createObjectStore('messages', { keyPath: 'id' });
    messages.createIndex('peer', 'peer');
  },
});
export interface Identity {
  profile: Profile;
  privateKey: CryptoKey;
}
export interface Contact extends Profile {
  accepted: boolean;
  pending?: 'incoming' | 'outgoing';
  verified?: boolean;
  unread?: number;
}
export interface ChatMessage {
  id: string;
  peer: string;
  from: string;
  text: string;
  at: number;
  state: 'sending' | 'delivered' | 'received' | 'failed';
  file?: { name: string; type: string; size: number; blob: Blob };
}
export const encode = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
export const decode = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export async function fingerprint(key: JsonWebKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyText(key)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function getIdentity(): Promise<Identity> {
  const saved = await (await db).get('settings', 'identity');
  if (saved) return saved;
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const key = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const identity: Identity = {
    profile: {
      id: (await fingerprint(key)).slice(0, 24),
      name: '',
      bio: 'Here for the good conversations.',
      color: '#b9ef69',
      key,
    },
    privateKey: keys.privateKey,
  };
  // Serialize identity creation across tabs to avoid overwriting a generated identity.
  const tx = (await db).transaction('settings', 'readwrite');
  const existing = await tx.store.get('identity');
  if (!existing) await tx.store.put(identity, 'identity');
  await tx.done;
  return existing || identity;
}
export const saveIdentity = async (identity: Identity) =>
  (await db).put('settings', identity, 'identity');
export const sign = async (identity: Identity, value: string) =>
  encode(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      identity.privateKey,
      new TextEncoder().encode(value),
    ),
  );
export async function verify(profile: Profile, signal: Signal) {
  if (
    !validProfile(profile) ||
    signal.from !== profile.id ||
    (await fingerprint(profile.key)).slice(0, 24) !== profile.id
  )
    return false;
  if (
    typeof signal.id !== 'string' ||
    signal.id.length > 64 ||
    typeof signal.to !== 'string' ||
    !Number.isFinite(signal.at) ||
    Math.abs(Date.now() - signal.at) > 120000 ||
    !signal.body ||
    typeof signal.body.type !== 'string' ||
    typeof signal.signature !== 'string'
  )
    return false;
  const key = await crypto.subtle.importKey(
    'jwk',
    profile.key,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    decode(signal.signature),
    new TextEncoder().encode(signalText(signal)),
  );
}
export function inviteCode(profile: Profile) {
  return 'wind:' + encode(new TextEncoder().encode(JSON.stringify(profile)).buffer);
}
export async function parseInvite(input: string): Promise<Profile> {
  const code = input
    .trim()
    .replace(/^.*#invite=/, '')
    .replace(/^wind:/, '');
  let profile: unknown;
  try {
    profile = JSON.parse(new TextDecoder().decode(decode(code)));
  } catch {
    throw new Error('That invite doesn’t look right. Paste a complete Wind invite.');
  }
  if (!validProfile(profile) || (await fingerprint(profile.key)).slice(0, 24) !== profile.id)
    throw new Error('This invite has an invalid identity. Ask for a new one.');
  return profile;
}
