import crypto from 'node:crypto';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_FALLBACK_SECRET;
}

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(plain: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  try {
    const derived = crypto.scryptSync(plain, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function signFileUrl(
  fileId: string,
  viewerId: string,
  ttlSeconds = 900,
  options?: { shareToken?: string; download?: boolean; vaultScope?: boolean }
): { url: string; expiresAt: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const shareToken = options?.shareToken || '';
  const vaultFlag = options?.vaultScope ? '1' : '0';
  const payload = `${fileId}:${viewerId}:${exp}:${shareToken}:${vaultFlag}`;
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');

  const params = new URLSearchParams({
    uid: viewerId,
    exp: String(exp),
    sig,
  });
  if (shareToken) params.set('st', shareToken);
  if (options?.vaultScope) params.set('vs', '1');
  if (options?.download) params.set('download', '1');

  return {
    url: `/api/files/${encodeURIComponent(fileId)}/content?${params.toString()}`,
    expiresAt: exp * 1000,
  };
}

export function verifyFileSignature(
  fileId: string,
  viewerId: string,
  expStr: string,
  sig: string,
  shareToken = '',
  vaultFlag = '0'
): boolean {
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) {
    return false;
  }
  const payload = `${fileId}:${viewerId}:${exp}:${shareToken}:${vaultFlag}`;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createVaultToken(userId: string, ttlMinutes = 15): { token: string; expiresAt: number } {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, ttlMinutes) * 60;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const body = Buffer.from(JSON.stringify({ uid: userId, exp, nonce })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`vault:${body}`)
    .digest('base64url');
  return {
    token: `${body}.${sig}`,
    expiresAt: exp * 1000,
  };
}

export function verifyVaultToken(token: string | undefined, expectedUserId: string): boolean {
  if (!token || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`vault:${body}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      uid?: string;
      exp?: number;
    };
    if (parsed.uid !== expectedUserId) return false;
    if (!parsed.exp || Math.floor(Date.now() / 1000) > parsed.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function resolveConfinedStoragePath(baseDir: string, storageKey: string): string | null {
  if (!storageKey || storageKey.includes('..') || storageKey.includes('/') || storageKey.includes('\\')) {
    return null;
  }
  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, storageKey);
  if (!resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }
  return resolved;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

export function createRateLimiter(options: {
  name: string;
  windowMs: number;
  maxRequests: number;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.name}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, options.maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > options.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'Rate limit reached. Please wait a few seconds and try again.',
        code: 'RATE_LIMITED',
        retryAfterSeconds,
      });
    }
    return next();
  };
}
