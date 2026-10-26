import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';

/**
 * Signed bearer tokens carrying a user id. Login is a development-only
 * email sign-in for now; real sign-in (password, Google, SSO) replaces the
 * login route later without changing how tokens are checked.
 */
const TTL_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET must be set in production');
  return 'tessera-dev-secret';
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function issueToken(userId: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string, now = Date.now()): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string; exp?: number };
    if (!sub || !exp || exp * 1000 < now) return null;
    return sub;
  } catch {
    return null;
  }
}

export function userIdFrom(req: FastifyRequest): string {
  const header = req.headers.authorization;
  const userId = header?.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
  if (!userId) throw new HttpError(401, 'Sign in required');
  return userId;
}
