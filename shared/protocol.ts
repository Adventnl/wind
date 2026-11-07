export interface Profile {
  id: string;
  name: string;
  bio: string;
  color: string;
  avatar?: string;
  key: JsonWebKey;
}
export interface Signal {
  id: string;
  from: string;
  to: string;
  at: number;
  body: Record<string, unknown> & { type: string };
  signature: string;
}
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_TEXT = 8000;
export const MAX_SIGNAL = 180_000;
export function keyText(key: JsonWebKey): string {
  return JSON.stringify({ kty: key.kty, crv: key.crv, x: key.x, y: key.y });
}
export function signalText(signal: Omit<Signal, 'signature'>): string {
  return JSON.stringify({
    id: signal.id,
    from: signal.from,
    to: signal.to,
    at: signal.at,
    body: signal.body,
  });
}
export function validProfile(p: unknown): p is Profile {
  if (!p || typeof p !== 'object') return false;
  const v = p as Profile;
  return (
    typeof v.id === 'string' &&
    /^[a-f0-9]{24}$/.test(v.id) &&
    typeof v.name === 'string' &&
    v.name.trim().length > 0 &&
    v.name.length <= 32 &&
    typeof v.bio === 'string' &&
    v.bio.length <= 140 &&
    typeof v.color === 'string' &&
    /^#[a-fA-F0-9]{6}$/.test(v.color) &&
    (!v.avatar ||
      (typeof v.avatar === 'string' &&
        v.avatar.length < 100000 &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.avatar))) &&
    !!v.key &&
    v.key.kty === 'EC' &&
    v.key.crv === 'P-256' &&
    typeof v.key.x === 'string' &&
    typeof v.key.y === 'string' &&
    !v.key.d
  );
}
