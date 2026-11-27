import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as archiverNs from 'archiver';
import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  db,
  STORAGE_OBJECTS_DIR,
  STORAGE_TEMP_DIR,
} from './db.ts';
import {
  createRateLimiter,
  createVaultToken,
  generateOpaqueToken,
  hashSecret,
  resolveConfinedStoragePath,
  signFileUrl,
  verifyFileSignature,
  verifySecret,
  verifyVaultToken,
} from './security.ts';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  password_hash: string;
  role: string;
  is_demo: number;
  vault_pin_hash: string | null;
  vault_auto_lock_minutes: number;
  theme_pref: string;
  language_pref: string;
  upload_quality: string;
  notify_shares: number;
  notify_uploads: number;
  created_at: string;
}

interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.msi',
  '.dll',
  '.vbs',
  '.ps1',
]);

const uploadMiddleware = multer({
  dest: STORAGE_TEMP_DIR,
  limits: {
    fileSize: 250 * 1024 * 1024, // 250 MB per file
    files: 50,
  },
});

function sanitizeDisplayFilename(rawName: string): string {
  const base = path.basename(rawName || 'untitled').replace(/[\x00-\x1f<>:"|?*]/g, '_').trim();
  return base || 'untitled';
}

function inferMediaKind(
  mimeType: string,
  fileName: string
): 'photo' | 'video' | 'document' | 'audio' | 'archive' | 'other' {
  const ext = path.extname(fileName).toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (
    mime.startsWith('image/') ||
    ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.avif', '.svg'].includes(ext)
  ) {
    return 'photo';
  }
  if (mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'].includes(ext)) {
    return 'audio';
  }
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].includes(ext) || mime.includes('zip')) {
    return 'archive';
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/pdf' ||
    mime.includes('document') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime === 'application/json' ||
    [
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.txt',
      '.md',
      '.csv',
      '.json',
      '.xml',
      '.rtf',
    ].includes(ext)
  ) {
    return 'document';
  }
  return 'other';
}

function getRealDiskStats(): {
  provisionedCapacityBytes: number;
  provisionedAvailableBytes: number;
} {
  try {
    const stat = fs.statfsSync(STORAGE_OBJECTS_DIR);
    return {
      provisionedCapacityBytes: Number(stat.bsize) * Number(stat.blocks),
      provisionedAvailableBytes: Number(stat.bsize) * Number(stat.bavail),
    };
  } catch {
    return {
      provisionedCapacityBytes: 0,
      provisionedAvailableBytes: 0,
    };
  }
}

function logActivity(
  userId: string,
  action: string,
  targetName: string,
  targetType: string,
  details = ''
) {
  db.prepare(
    `INSERT INTO activity_logs (id, user_id, action, target_name, target_type, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(`act_${crypto.randomUUID().slice(0, 12)}`, userId, action, targetName, targetType, details, new Date().toISOString());
}

function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  resourceType?: string,
  resourceId?: string
) {
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, message, resource_type, resource_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    `ntf_${crypto.randomUUID().slice(0, 12)}`,
    userId,
    type,
    title,
    message,
    resourceType || null,
    resourceId || null,
    new Date().toISOString()
  );
}

function sanitizeUserResponse(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    role: user.role,
    isDemo: Boolean(user.is_demo),
    hasVaultPin: Boolean(user.vault_pin_hash),
    vaultAutoLockMinutes: user.vault_auto_lock_minutes,
    themePref: user.theme_pref,
    languagePref: user.language_pref,
    uploadQuality: user.upload_quality,
    notifyShares: Boolean(user.notify_shares),
    notifyUploads: Boolean(user.notify_uploads),
    createdAt: user.created_at,
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Invalid session token' });
  }
  const nowIso = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, nowIso) as AuthUser | undefined;

  if (!row) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  db.prepare('UPDATE sessions SET last_active_at = ? WHERE token = ?').run(nowIso, token);
  req.user = row;
  req.sessionToken = token;
  return next();
}

function requireVaultToken(req: AuthedRequest, res: Response): boolean {
  const user = req.user!;
  const vaultToken = req.headers['x-vault-token'] as string | undefined;
  if (!verifyVaultToken(vaultToken, user.id)) {
    res.status(403).json({
      error: 'Hidden Vault is locked. Please unlock with your Vault PIN.',
      code: 'VAULT_LOCKED',
    });
    return false;
  }
  return true;
}

function getFolderAncestors(folderId: string | null): string[] {
  const ancestors: string[] = [];
  let current = folderId;
  let guard = 0;
  while (current && guard < 32) {
    ancestors.push(current);
    const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(current) as
      | { parent_id: string | null }
      | undefined;
    current = row?.parent_id ?? null;
    guard += 1;
  }
  return ancestors;
}

function checkUserSharePermission(
  userId: string,
  userEmail: string,
  fileRow: any
): 'viewer' | 'commenter' | 'editor' | null {
  if (fileRow.is_vault === 1 || fileRow.is_trashed === 1) return null;
  const nowIso = new Date().toISOString();

  // Direct file share
  const direct = db
    .prepare(
      `SELECT permission FROM shares
       WHERE resource_type = 'file' AND resource_id = ?
         AND status = 'accepted'
         AND (recipient_id = ? OR LOWER(recipient_email) = LOWER(?))
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1`
    )
    .get(fileRow.id, userId, userEmail, nowIso) as { permission: 'viewer' | 'commenter' | 'editor' } | undefined;
  if (direct) return direct.permission;

  // Ancestor folder share
  if (fileRow.folder_id) {
    const ancestorIds = getFolderAncestors(fileRow.folder_id);
    if (ancestorIds.length > 0) {
      const placeholders = ancestorIds.map(() => '?').join(',');
      const folderShare = db
        .prepare(
          `SELECT permission FROM shares
           WHERE resource_type = 'folder' AND resource_id IN (${placeholders})
             AND status = 'accepted'
             AND (recipient_id = ? OR LOWER(recipient_email) = LOWER(?))
             AND (expires_at IS NULL OR expires_at > ?)
           LIMIT 1`
        )
        .get(...ancestorIds, userId, userEmail, nowIso) as
        | { permission: 'viewer' | 'commenter' | 'editor' }
        | undefined;
      if (folderShare) return folderShare.permission;
    }
  }

  // Album share
  const albumShare = db
    .prepare(
      `SELECT s.permission FROM shares s
       JOIN album_items ai ON ai.album_id = s.resource_id
       WHERE s.resource_type = 'album' AND ai.file_id = ?
         AND s.status = 'accepted'
         AND (s.recipient_id = ? OR LOWER(s.recipient_email) = LOWER(?))
         AND (s.expires_at IS NULL OR s.expires_at > ?)
       LIMIT 1`
    )
    .get(fileRow.id, userId, userEmail, nowIso) as
    | { permission: 'viewer' | 'commenter' | 'editor' }
    | undefined;
  if (albumShare) return albumShare.permission;

  return null;
}

function serializeFile(
  fileRow: any,
  viewerId: string,
  options?: {
    shareToken?: string;
    vaultScope?: boolean;
    permission?: string;
    ownerName?: string;
    ownerEmail?: string;
    savedMode?: 'reference' | 'copy' | null;
    savedShareId?: string | null;
    allowCopy?: boolean;
  }
) {
  const signed = signFileUrl(fileRow.id, viewerId, 900, {
    shareToken: options?.shareToken,
    vaultScope: options?.vaultScope,
  });
  const downloadSigned = signFileUrl(fileRow.id, viewerId, 900, {
    shareToken: options?.shareToken,
    vaultScope: options?.vaultScope,
    download: true,
  });
  const derivedSavedMode =
    options?.savedMode !== undefined
      ? options.savedMode
      : fileRow.source_provider === 'shared_copy'
      ? 'copy'
      : null;

  return {
    id: fileRow.id,
    ownerId: fileRow.owner_id,
    ownerName: options?.ownerName ?? fileRow.owner_name ?? undefined,
    ownerEmail: options?.ownerEmail ?? fileRow.owner_email ?? undefined,
    folderId: fileRow.folder_id,
    name: fileRow.name,
    originalName: fileRow.original_name,
    mimeType: fileRow.mime_type,
    mediaKind: fileRow.media_kind,
    sizeBytes: fileRow.size_bytes,
    width: fileRow.width,
    height: fileRow.height,
    durationSec: fileRow.duration_sec,
    takenAt: fileRow.taken_at,
    isVault: Boolean(fileRow.is_vault),
    isFavorite: Boolean(fileRow.is_favorite),
    isTrashed: Boolean(fileRow.is_trashed),
    trashedAt: fileRow.trashed_at,
    lastOpenedAt: fileRow.last_opened_at,
    createdAt: fileRow.created_at,
    updatedAt: fileRow.updated_at,
    url: signed.url,
    downloadUrl: downloadSigned.url,
    urlExpiresAt: signed.expiresAt,
    permission: options?.permission ?? 'editor',
    sourceProvider: fileRow.source_provider || 'upload',
    savedMode: derivedSavedMode,
    savedShareId: options?.savedShareId ?? fileRow.copied_from_share_id ?? null,
    copiedFromOwnerName: fileRow.copied_from_owner_name ?? null,
    allowCopy: options?.allowCopy ?? true,
  };
}

function removeUnreferencedStorageObject(storageKey: string) {
  const count = db
    .prepare('SELECT COUNT(*) AS cnt FROM files WHERE storage_key = ?')
    .get(storageKey) as { cnt: number };
  if (count.cnt === 0) {
    const confined = resolveConfinedStoragePath(STORAGE_OBJECTS_DIR, storageKey);
    if (confined && fs.existsSync(confined)) {
      try {
        fs.unlinkSync(confined);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export function registerApiRoutes(app: Express): void {
  const apiLimiter = createRateLimiter({ name: 'api', windowMs: 60_000, maxRequests: 360 });
  const authLimiter = createRateLimiter({ name: 'auth', windowMs: 60_000, maxRequests: 40 });

  app.use('/api', apiLimiter);

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'ASHCLOUD', time: new Date().toISOString() });
  });

  // --- AUTH ---
  app.get('/api/auth/demo-accounts', (_req, res) => {
    const demos = db
      .prepare('SELECT id, name, email, avatar_url, role FROM users WHERE is_demo = 1 ORDER BY created_at ASC')
      .all() as Array<{ id: string; name: string; email: string; avatar_url: string | null; role: string }>;
    res.json({
      accounts: demos.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatar_url,
        role: u.role,
      })),
    });
  });

  app.post('/api/auth/register', authLimiter, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Please provide your full name.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'member', 0, ?)`
    ).run(userId, email, name, hashSecret(password), nowIso);

    // Link any pending shares addressed to this email
    db.prepare(
      `UPDATE shares SET recipient_id = ? WHERE recipient_id IS NULL AND LOWER(recipient_email) = LOWER(?)`
    ).run(userId, email);

    const token = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const deviceInfo = String(req.headers['user-agent'] || 'Web Browser').slice(0, 120);
    db.prepare(
      `INSERT INTO sessions (token, user_id, device_info, created_at, last_active_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, userId, deviceInfo, nowIso, nowIso, expiresAt);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as AuthUser;
    logActivity(userId, 'signed_up', 'ASHCLOUD Account', 'account', 'Created personal workspace');
    return res.status(201).json({ token, user: sanitizeUserResponse(user) });
  });

  app.post('/api/auth/login', authLimiter, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email) as AuthUser | undefined;
    if (!user || !verifySecret(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateOpaqueToken(32);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const deviceInfo = String(req.headers['user-agent'] || 'Web Browser').slice(0, 120);
    db.prepare(
      `INSERT INTO sessions (token, user_id, device_info, created_at, last_active_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, user.id, deviceInfo, nowIso, nowIso, expiresAt);

    logActivity(user.id, 'signed_in', 'Web Session', 'session', 'Authenticated via password');
    return res.json({ token, user: sanitizeUserResponse(user) });
  });

  app.post('/api/auth/demo-login', authLimiter, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND is_demo = 1')
      .get(email) as AuthUser | undefined;
    if (!user) {
      return res.status(404).json({ error: 'Workspace demo account not found.' });
    }

    const token = generateOpaqueToken(32);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const deviceInfo = String(req.headers['user-agent'] || 'Web Browser').slice(0, 120);
    db.prepare(
      `INSERT INTO sessions (token, user_id, device_info, created_at, last_active_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, user.id, deviceInfo, nowIso, nowIso, expiresAt);

    return res.json({ token, user: sanitizeUserResponse(user) });
  });

  app.post('/api/auth/google', authLimiter, async (req, res) => {
    const idToken = String(req.body?.idToken || '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'Missing Google sign-in token.' });
    }

    try {
      const fbConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
      if (!fs.existsSync(fbConfigPath)) {
        return res.status(503).json({ error: 'Google sign-in configuration is not available on this server.' });
      }
      const fbConfig = JSON.parse(fs.readFileSync(fbConfigPath, 'utf8')) as { apiKey?: string };
      if (!fbConfig.apiKey) {
        return res.status(503).json({ error: 'Firebase API key is not configured.' });
      }

      const verifyRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbConfig.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );

      if (!verifyRes.ok) {
        return res.status(401).json({ error: 'Google identity token verification failed.' });
      }

      const verifyData = (await verifyRes.json()) as {
        users?: Array<{
          email?: string;
          displayName?: string;
          photoUrl?: string;
          emailVerified?: boolean;
        }>;
      };
      const fbUser = verifyData.users?.[0];
      if (!fbUser?.email) {
        return res.status(401).json({ error: 'Google account did not return a verified email address.' });
      }

      const email = fbUser.email.trim().toLowerCase();
      const displayName = (fbUser.displayName || email.split('@')[0] || 'ASHCLOUD User').trim();
      const photoUrl = fbUser.photoUrl || null;
      const nowIso = new Date().toISOString();

      let user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email) as AuthUser | undefined;
      if (!user) {
        const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
        db.prepare(
          `INSERT INTO users (id, email, name, password_hash, avatar_url, role, is_demo, created_at)
           VALUES (?, ?, ?, ?, ?, 'member', 0, ?)`
        ).run(userId, email, displayName, hashSecret(crypto.randomBytes(32).toString('hex')), photoUrl, nowIso);

        db.prepare(
          `UPDATE shares SET recipient_id = ? WHERE recipient_id IS NULL AND LOWER(recipient_email) = LOWER(?)`
        ).run(userId, email);

        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as AuthUser;
        logActivity(userId, 'signed_up', 'ASHCLOUD Account', 'account', 'Created via Google Sign-In');
      } else {
        if (!user.avatar_url && photoUrl) {
          db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(photoUrl, user.id);
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as AuthUser;
        }
        logActivity(user.id, 'signed_in', 'Web Session', 'session', 'Authenticated via Google Sign-In');
      }

      const token = generateOpaqueToken(32);
      const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
      const deviceInfo = String(req.headers['user-agent'] || 'Web Browser').slice(0, 120);
      db.prepare(
        `INSERT INTO sessions (token, user_id, device_info, created_at, last_active_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(token, user.id, deviceInfo, nowIso, nowIso, expiresAt);

      return res.json({ token, user: sanitizeUserResponse(user) });
    } catch (err: any) {
      console.error('Google auth verify error:', err);
      return res.status(500).json({ error: 'Unable to verify Google sign-in.' });
    }
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
    if (req.sessionToken) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: sanitizeUserResponse(req.user!) });
  });

  app.patch('/api/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const name = typeof req.body?.name === 'string' && req.body.name.trim().length >= 2 ? req.body.name.trim() : user.name;
    const themePref = req.body?.themePref === 'light' || req.body?.themePref === 'dark' ? req.body.themePref : user.theme_pref;
    const languagePref = typeof req.body?.languagePref === 'string' ? req.body.languagePref.slice(0, 12) : user.language_pref;
    const uploadQuality = req.body?.uploadQuality === 'high' || req.body?.uploadQuality === 'original' ? req.body.uploadQuality : user.upload_quality;
    const notifyShares = typeof req.body?.notifyShares === 'boolean' ? (req.body.notifyShares ? 1 : 0) : user.notify_shares;
    const notifyUploads = typeof req.body?.notifyUploads === 'boolean' ? (req.body.notifyUploads ? 1 : 0) : user.notify_uploads;
    const vaultAutoLockMinutes =
      typeof req.body?.vaultAutoLockMinutes === 'number' && req.body.vaultAutoLockMinutes >= 1 && req.body.vaultAutoLockMinutes <= 120
        ? Math.round(req.body.vaultAutoLockMinutes)
        : user.vault_auto_lock_minutes;

    db.prepare(
      `UPDATE users SET name = ?, theme_pref = ?, language_pref = ?, upload_quality = ?, notify_shares = ?, notify_uploads = ?, vault_auto_lock_minutes = ? WHERE id = ?`
    ).run(name, themePref, languagePref, uploadQuality, notifyShares, notifyUploads, vaultAutoLockMinutes, user.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as AuthUser;
    res.json({ user: sanitizeUserResponse(updated) });
  });

  app.get('/api/auth/sessions', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare(
        `SELECT token, device_info, created_at, last_active_at, expires_at
         FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_active_at DESC`
      )
      .all(user.id, new Date().toISOString()) as Array<{
      token: string;
      device_info: string;
      created_at: string;
      last_active_at: string;
      expires_at: string;
    }>;

    res.json({
      sessions: rows.map((s) => ({
        id: s.token.slice(0, 12),
        deviceInfo: s.device_info,
        createdAt: s.created_at,
        lastActiveAt: s.last_active_at,
        expiresAt: s.expires_at,
        isCurrent: s.token === req.sessionToken,
      })),
    });
  });

  app.delete('/api/auth/sessions/:prefix', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const prefix = String(req.params.prefix || '');
    if (prefix.length < 8) {
      return res.status(400).json({ error: 'Invalid session reference.' });
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token LIKE ?').run(user.id, `${prefix}%`);
    res.json({ ok: true });
  });

  app.get('/api/users/directory', requireAuth, (req: AuthedRequest, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const user = req.user!;
    const rows = q
      ? db
          .prepare(
            `SELECT id, name, email, avatar_url FROM users
             WHERE id != ? AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?)
             LIMIT 10`
          )
          .all(user.id, `%${q}%`, `%${q}%`)
      : db.prepare('SELECT id, name, email, avatar_url FROM users WHERE id != ? LIMIT 10').all(user.id);

    res.json({
      users: (rows as any[]).map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        avatarUrl: r.avatar_url,
      })),
    });
  });

  // --- STORAGE SUMMARY & 512 TB ARCHITECTURE ---
  app.get('/api/storage/summary', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const targetTb = Number(process.env.ASHCLOUD_TARGET_CAPACITY_TB || 512);
    const targetCapacityBytes = targetTb * 1000 ** 4; // 512 decimal TB
    const disk = getRealDiskStats();

    const userFiles = db
      .prepare('SELECT id, name, media_kind, size_bytes, storage_key, is_vault, is_trashed, created_at FROM files WHERE owner_id = ?')
      .all(user.id) as Array<{
      id: string;
      name: string;
      media_kind: string;
      size_bytes: number;
      storage_key: string;
      is_vault: number;
      is_trashed: number;
      created_at: string;
    }>;

    let photosBytes = 0;
    let videosBytes = 0;
    let driveBytes = 0;
    let vaultBytes = 0;
    let trashedBytes = 0;
    const seenKeys = new Set<string>();
    let deduplicatedUserBytes = 0;

    for (const f of userFiles) {
      if (!seenKeys.has(f.storage_key)) {
        seenKeys.add(f.storage_key);
        deduplicatedUserBytes += f.size_bytes;
      }
      if (f.is_trashed === 1) {
        trashedBytes += f.size_bytes;
      } else if (f.is_vault === 1) {
        vaultBytes += f.size_bytes;
      } else if (f.media_kind === 'photo') {
        photosBytes += f.size_bytes;
      } else if (f.media_kind === 'video') {
        videosBytes += f.size_bytes;
      } else {
        driveBytes += f.size_bytes;
      }
    }

    const platformRow = db
      .prepare(
        `SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM (
           SELECT DISTINCT storage_key, size_bytes FROM files
         )`
      )
      .get() as { total_bytes: number };

    const folderCount = (
      db
        .prepare('SELECT COUNT(*) AS cnt FROM folders WHERE owner_id = ? AND is_vault = 0 AND is_trashed = 0')
        .get(user.id) as { cnt: number }
    ).cnt;

    const counts = {
      photos: userFiles.filter((f) => f.is_vault === 0 && f.is_trashed === 0 && f.media_kind === 'photo').length,
      videos: userFiles.filter((f) => f.is_vault === 0 && f.is_trashed === 0 && f.media_kind === 'video').length,
      files: userFiles.filter((f) => f.is_vault === 0 && f.is_trashed === 0).length,
      folders: folderCount,
      vaultItems: userFiles.filter((f) => f.is_vault === 1 && f.is_trashed === 0).length,
      trashedItems: userFiles.filter((f) => f.is_trashed === 1).length,
    };

    const largeFiles = userFiles
      .filter((f) => f.is_vault === 0 && f.is_trashed === 0)
      .sort((a, b) => b.size_bytes - a.size_bytes)
      .slice(0, 8)
      .map((f) => ({
        id: f.id,
        name: f.name,
        mediaKind: f.media_kind,
        sizeBytes: f.size_bytes,
        createdAt: f.created_at,
      }));

    // Build 7-day upload byte trend from actual created_at timestamps
    const dayMap = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, 0);
    }
    for (const f of userFiles) {
      const dayKey = f.created_at.slice(0, 10);
      if (dayMap.has(dayKey)) {
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + f.size_bytes);
      }
    }
    const uploadHistory = Array.from(dayMap.entries()).map(([date, bytes]) => ({
      date,
      label: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      bytes,
    }));

    res.json({
      unitSystem: 'decimal_TB',
      targetCapacityTb: targetTb,
      targetCapacityBytes,
      provisionedCapacityBytes: disk.provisionedCapacityBytes,
      provisionedAvailableBytes: disk.provisionedAvailableBytes,
      platformUsedBytes: platformRow.total_bytes,
      userUsedBytes: deduplicatedUserBytes,
      breakdown: {
        photosBytes,
        videosBytes,
        driveBytes,
        vaultBytes,
        trashedBytes,
      },
      counts,
      largeFiles,
      uploadHistory,
      architecture: {
        provider: 'Local Private Object Store (S3/R2 Multipart Adapter Ready)',
        targetProvisionedOnCurrentNode: disk.provisionedCapacityBytes >= targetCapacityBytes,
        deduplicatedSharing: true,
      },
    });
  });

  // --- CACHED LIBRARY PAYLOAD ---
  app.get('/api/library', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const includeTrashed = req.query.includeTrashed === '1';

    const files = db
      .prepare(
        `SELECT * FROM files
         WHERE owner_id = ? AND is_vault = 0 ${includeTrashed ? '' : 'AND is_trashed = 0'}
         ORDER BY COALESCE(taken_at, created_at) DESC`
      )
      .all(user.id) as any[];

    const folders = db
      .prepare(
        `SELECT * FROM folders
         WHERE owner_id = ? AND is_vault = 0 ${includeTrashed ? '' : 'AND is_trashed = 0'}
         ORDER BY name ASC`
      )
      .all(user.id) as any[];

    const trashedFiles = db
      .prepare('SELECT * FROM files WHERE owner_id = ? AND is_trashed = 1 AND is_vault = 0 ORDER BY trashed_at DESC')
      .all(user.id) as any[];

    const trashedFolders = db
      .prepare('SELECT * FROM folders WHERE owner_id = ? AND is_trashed = 1 AND is_vault = 0 ORDER BY trashed_at DESC')
      .all(user.id) as any[];

    const albums = db
      .prepare('SELECT * FROM albums WHERE owner_id = ? ORDER BY updated_at DESC')
      .all(user.id) as any[];

    const albumItems = db
      .prepare(
        `SELECT ai.album_id, ai.file_id, ai.added_at
         FROM album_items ai
         JOIN albums a ON a.id = ai.album_id
         JOIN files f ON f.id = ai.file_id
         WHERE a.owner_id = ? AND f.is_vault = 0 AND f.is_trashed = 0`
      )
      .all(user.id) as Array<{ album_id: string; file_id: string; added_at: string }>;

    const itemsByAlbum = new Map<string, string[]>();
    for (const item of albumItems) {
      const list = itemsByAlbum.get(item.album_id) || [];
      list.push(item.file_id);
      itemsByAlbum.set(item.album_id, list);
    }

    const fileMap = new Map<string, any>();
    const serializedFiles = files.map((f) => {
      const sf = serializeFile(f, user.id, { ownerName: user.name, ownerEmail: user.email });
      fileMap.set(f.id, sf);
      return sf;
    });

    // Include saved shared references that are still active (non-revoked, non-expired, non-trashed, non-vault)
    const nowIso = new Date().toISOString();
    const savedRefs = db
      .prepare(
        `SELECT ssi.share_id, ssi.created_at AS saved_at, f.*, u.name AS owner_name, u.email AS owner_email, s.permission, s.allow_copy
         FROM saved_shared_items ssi
         JOIN shares s ON s.id = ssi.share_id
         JOIN files f ON f.id = ssi.file_id
         JOIN users u ON u.id = f.owner_id
         WHERE ssi.user_id = ?
           AND s.status = 'accepted'
           AND (s.expires_at IS NULL OR s.expires_at > ?)
           AND f.is_vault = 0
           AND f.is_trashed = 0
         ORDER BY ssi.created_at DESC`
      )
      .all(user.id, nowIso) as any[];

    const seenRefFileIds = new Set<string>(serializedFiles.map((f) => f.id));
    for (const refRow of savedRefs) {
      if (seenRefFileIds.has(refRow.id)) continue;
      // Double-check live share permission across file/folder/album
      const perm = checkUserSharePermission(user.id, user.email, refRow);
      if (!perm) continue;
      seenRefFileIds.add(refRow.id);
      const sf = serializeFile(refRow, user.id, {
        ownerName: refRow.owner_name,
        ownerEmail: refRow.owner_email,
        permission: perm,
        savedMode: 'reference',
        savedShareId: refRow.share_id,
        allowCopy: Boolean(refRow.allow_copy),
      });
      serializedFiles.push(sf);
    }

    const serializedAlbums = albums.map((a) => {
      const fIds = itemsByAlbum.get(a.id) || [];
      const coverId = a.cover_file_id && fileMap.has(a.cover_file_id) ? a.cover_file_id : fIds[0] || null;
      return {
        id: a.id,
        ownerId: a.owner_id,
        title: a.title,
        description: a.description,
        coverFileId: coverId,
        coverUrl: coverId ? fileMap.get(coverId)?.url || null : null,
        fileIds: fIds,
        itemCount: fIds.length,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      };
    });

    res.json({
      files: serializedFiles,
      folders: folders.map((fld) => ({
        id: fld.id,
        ownerId: fld.owner_id,
        parentId: fld.parent_id,
        name: fld.name,
        isVault: Boolean(fld.is_vault),
        isFavorite: Boolean(fld.is_favorite),
        isTrashed: Boolean(fld.is_trashed),
        trashedAt: fld.trashed_at,
        createdAt: fld.created_at,
        updatedAt: fld.updated_at,
      })),
      trashedFiles: trashedFiles.map((f) => serializeFile(f, user.id, { ownerName: user.name, ownerEmail: user.email })),
      trashedFolders: trashedFolders.map((fld) => ({
        id: fld.id,
        ownerId: fld.owner_id,
        parentId: fld.parent_id,
        name: fld.name,
        isVault: Boolean(fld.is_vault),
        isFavorite: Boolean(fld.is_favorite),
        isTrashed: Boolean(fld.is_trashed),
        trashedAt: fld.trashed_at,
        createdAt: fld.created_at,
        updatedAt: fld.updated_at,
      })),
      albums: serializedAlbums,
    });
  });

  // Batch URL re-signing (avoids N individual signing calls)
  app.post('/api/files/sign-batch', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.slice(0, 60) : [];
    const vaultHeader = req.headers['x-vault-token'] as string | undefined;
    const hasValidVault = verifyVaultToken(vaultHeader, user.id);

    const results: Record<string, { url: string; downloadUrl: string; expiresAt: number }> = {};
    for (const id of fileIds) {
      if (typeof id !== 'string') continue;
      const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
      if (!fileRow) continue;

      if (fileRow.owner_id === user.id) {
        if (fileRow.is_vault === 1 && !hasValidVault) continue;
        const s = signFileUrl(fileRow.id, user.id, 900, { vaultScope: fileRow.is_vault === 1 });
        const d = signFileUrl(fileRow.id, user.id, 900, { vaultScope: fileRow.is_vault === 1, download: true });
        results[id] = { url: s.url, downloadUrl: d.url, expiresAt: s.expiresAt };
      } else {
        const perm = checkUserSharePermission(user.id, user.email, fileRow);
        if (!perm) continue;
        const s = signFileUrl(fileRow.id, user.id, 900);
        const d = signFileUrl(fileRow.id, user.id, 900, { download: true });
        results[id] = { url: s.url, downloadUrl: d.url, expiresAt: s.expiresAt };
      }
    }

    res.json({ urls: results });
  });

  // --- DIRECT FILE & FOLDER UPLOAD ---
  app.post('/api/upload', requireAuth, uploadMiddleware.single('file'), (req: AuthedRequest, res) => {
    const user = req.user!;
    const uploaded = req.file;
    if (!uploaded) {
      return res.status(400).json({ error: 'No file payload received.' });
    }

    const cleanupTemp = () => {
      if (uploaded.path && fs.existsSync(uploaded.path)) {
        try {
          fs.unlinkSync(uploaded.path);
        } catch {
          // ignore
        }
      }
    };

    try {
      const rawName = String(req.body?.name || uploaded.originalname || 'file');
      const cleanName = sanitizeDisplayFilename(rawName);
      const ext = path.extname(cleanName).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        cleanupTemp();
        return res.status(400).json({ error: `File extension ${ext} is blocked for security.` });
      }

      const isVault = req.body?.isVault === 'true' || req.body?.isVault === '1';
      if (isVault) {
        const vaultToken = req.headers['x-vault-token'] as string | undefined;
        if (!verifyVaultToken(vaultToken, user.id)) {
          cleanupTemp();
          return res.status(403).json({ error: 'Unlock Hidden Vault before uploading private files.', code: 'VAULT_LOCKED' });
        }
      }

      // Check real provisioned disk capacity
      const disk = getRealDiskStats();
      if (disk.provisionedAvailableBytes > 0 && uploaded.size > disk.provisionedAvailableBytes) {
        cleanupTemp();
        return res.status(507).json({
          error: 'Available storage capacity on the backend node is exhausted.',
        });
      }

      let targetFolderId: string | null =
        typeof req.body?.folderId === 'string' && req.body.folderId.trim() ? req.body.folderId.trim() : null;

      if (targetFolderId) {
        const folderRow = db
          .prepare('SELECT id, owner_id, is_vault, is_trashed FROM folders WHERE id = ?')
          .get(targetFolderId) as any;
        if (!folderRow || folderRow.owner_id !== user.id || folderRow.is_trashed === 1) {
          cleanupTemp();
          return res.status(404).json({ error: 'Target folder not found.' });
        }
        if (Boolean(folderRow.is_vault) !== isVault) {
          cleanupTemp();
          return res.status(400).json({ error: 'Cannot mix Vault and regular folders.' });
        }
      }

      // Preserve nested folder hierarchy if relativePath is provided (Folder Upload)
      const relativePath = typeof req.body?.relativePath === 'string' ? req.body.relativePath : '';
      if (relativePath && relativePath.includes('/')) {
        const segments = relativePath
          .split('/')
          .map((s: string) => sanitizeDisplayFilename(s))
          .filter(Boolean);
        // Last segment is the filename itself
        const folderSegments = segments.slice(0, -1);
        for (const segName of folderSegments) {
          const existingFolder = db
            .prepare(
              `SELECT id FROM folders
               WHERE owner_id = ? AND ${targetFolderId ? 'parent_id = ?' : 'parent_id IS NULL'}
                 AND name = ? AND is_vault = ? AND is_trashed = 0`
            )
            .get(...(targetFolderId ? [user.id, targetFolderId, segName, isVault ? 1 : 0] : [user.id, segName, isVault ? 1 : 0])) as
            | { id: string }
            | undefined;

          if (existingFolder) {
            targetFolderId = existingFolder.id;
          } else {
            const newFolderId = `fld_${crypto.randomUUID().slice(0, 12)}`;
            const nowIso = new Date().toISOString();
            db.prepare(
              `INSERT INTO folders (id, owner_id, parent_id, name, is_vault, is_favorite, is_trashed, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
            ).run(newFolderId, user.id, targetFolderId, segName, isVault ? 1 : 0, nowIso, nowIso);
            targetFolderId = newFolderId;
          }
        }
      }

      // Duplicate handling
      const duplicateAction = String(req.body?.duplicateAction || 'keep_both');
      const existingSame = db
        .prepare(
          `SELECT * FROM files
           WHERE owner_id = ? AND ${targetFolderId ? 'folder_id = ?' : 'folder_id IS NULL'}
             AND name = ? AND is_vault = ? AND is_trashed = 0`
        )
        .get(...(targetFolderId ? [user.id, targetFolderId, cleanName, isVault ? 1 : 0] : [user.id, cleanName, isVault ? 1 : 0])) as any;

      let finalName = cleanName;
      if (existingSame) {
        if (duplicateAction === 'skip') {
          cleanupTemp();
          return res.json({
            skipped: true,
            file: serializeFile(existingSame, user.id, { vaultScope: isVault, ownerName: user.name, ownerEmail: user.email }),
          });
        }
        if (duplicateAction === 'keep_both') {
          const base = path.basename(cleanName, ext);
          let counter = 2;
          while (counter < 100) {
            const candidate = `${base} (${counter})${ext}`;
            const exists = db
              .prepare(
                `SELECT id FROM files
                 WHERE owner_id = ? AND ${targetFolderId ? 'folder_id = ?' : 'folder_id IS NULL'}
                   AND name = ? AND is_vault = ? AND is_trashed = 0`
              )
              .get(...(targetFolderId ? [user.id, targetFolderId, candidate, isVault ? 1 : 0] : [user.id, candidate, isVault ? 1 : 0]));
            if (!exists) {
              finalName = candidate;
              break;
            }
            counter += 1;
          }
        }
      }

      // Compute SHA-256 and move object to confined storage directory
      const fileBuf = fs.readFileSync(uploaded.path);
      const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
      const safeExt = ext.replace(/[^a-z0-9.]/gi, '').slice(0, 10);
      const storageKey = `${sha256.slice(0, 24)}-${crypto.randomUUID()}${safeExt}`;
      const targetPath = resolveConfinedStoragePath(STORAGE_OBJECTS_DIR, storageKey);
      if (!targetPath) {
        cleanupTemp();
        return res.status(500).json({ error: 'Failed to resolve storage path.' });
      }
      fs.writeFileSync(targetPath, fileBuf);
      cleanupTemp();

      const nowIso = new Date().toISOString();
      const mimeType = uploaded.mimetype || 'application/octet-stream';
      const mediaKind = inferMediaKind(mimeType, finalName);
      const width = req.body?.width ? Number(req.body.width) || null : null;
      const height = req.body?.height ? Number(req.body.height) || null : null;
      const durationSec = req.body?.durationSec ? Number(req.body.durationSec) || null : null;

      try {
        if (existingSame && duplicateAction === 'replace') {
          const oldStorageKey = existingSame.storage_key;
          db.prepare(
            `UPDATE files SET mime_type = ?, media_kind = ?, size_bytes = ?, storage_key = ?, sha256_hash = ?, width = ?, height = ?, duration_sec = ?, updated_at = ? WHERE id = ?`
          ).run(mimeType, mediaKind, uploaded.size, storageKey, sha256, width, height, durationSec, nowIso, existingSame.id);
          removeUnreferencedStorageObject(oldStorageKey);
          const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(existingSame.id) as any;
          logActivity(user.id, 'replaced', finalName, mediaKind, `${uploaded.size} bytes`);
          return res.status(201).json({
            file: serializeFile(updated, user.id, { vaultScope: isVault, ownerName: user.name, ownerEmail: user.email }),
          });
        }

        const fileId = `fil_${crypto.randomUUID().slice(0, 12)}`;
        db.prepare(
          `INSERT INTO files (
             id, owner_id, folder_id, name, original_name, mime_type, media_kind, size_bytes,
             storage_key, sha256_hash, width, height, duration_sec, taken_at,
             is_vault, is_favorite, is_trashed, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
        ).run(
          fileId,
          user.id,
          targetFolderId,
          finalName,
          cleanName,
          mimeType,
          mediaKind,
          uploaded.size,
          storageKey,
          sha256,
          width,
          height,
          durationSec,
          nowIso,
          isVault ? 1 : 0,
          nowIso,
          nowIso
        );

        const created = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
        if (!isVault) {
          logActivity(user.id, 'uploaded', finalName, mediaKind, `${uploaded.size} bytes`);
        }
        return res.status(201).json({
          file: serializeFile(created, user.id, { vaultScope: isVault, ownerName: user.name, ownerEmail: user.email }),
        });
      } catch (dbErr) {
        // Recover cleanly if DB write fails after storage write
        if (fs.existsSync(targetPath)) {
          try {
            fs.unlinkSync(targetPath);
          } catch {
            // ignore
          }
        }
        throw dbErr;
      }
    } catch (err: any) {
      cleanupTemp();
      console.error('Upload error:', err);
      return res.status(500).json({ error: err?.message || 'Upload failed.' });
    }
  });

  // --- SERVE PRIVATE OBJECT CONTENT VIA SIGNED URL ---
  app.get('/api/files/:id/content', (req, res) => {
    const fileId = String(req.params.id || '');
    const uid = String(req.query.uid || '');
    const exp = String(req.query.exp || '');
    const sig = String(req.query.sig || '');
    const st = String(req.query.st || '');
    const vs = String(req.query.vs || '0');
    const download = req.query.download === '1';

    if (!verifyFileSignature(fileId, uid, exp, sig, st, vs)) {
      return res.status(403).json({ error: 'Signed media URL expired or invalid.' });
    }

    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
    if (!fileRow) {
      return res.status(404).json({ error: 'File not found.' });
    }

    // Enforce Vault isolation
    if (fileRow.is_vault === 1) {
      if (vs !== '1' || fileRow.owner_id !== uid || st) {
        return res.status(403).json({ error: 'Hidden Vault access denied.' });
      }
    }

    // Re-verify live share revocation / expiry if accessed via share token or non-owner
    if (st) {
      const share = db
        .prepare(
          `SELECT * FROM shares
           WHERE share_token = ? AND status = 'accepted' AND (expires_at IS NULL OR expires_at > ?)`
        )
        .get(st, new Date().toISOString()) as any;
      if (!share) {
        return res.status(403).json({ error: 'Share link has expired or been revoked.' });
      }
    } else if (fileRow.owner_id !== uid) {
      const viewer = db.prepare('SELECT id, email FROM users WHERE id = ?').get(uid) as
        | { id: string; email: string }
        | undefined;
      if (!viewer || !checkUserSharePermission(viewer.id, viewer.email, fileRow)) {
        return res.status(403).json({ error: 'You no longer have permission to access this file.' });
      }
    }

    const objectPath = resolveConfinedStoragePath(STORAGE_OBJECTS_DIR, fileRow.storage_key);
    if (!objectPath || !fs.existsSync(objectPath)) {
      return res.status(404).json({ error: 'Stored object missing.' });
    }

    const stat = fs.statSync(objectPath);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');

    // Prevent active HTML/SVG script execution if opened directly
    const safeContentType =
      fileRow.mime_type === 'image/svg+xml' || fileRow.mime_type === 'text/html'
        ? 'text/plain; charset=utf-8'
        : fileRow.mime_type || 'application/octet-stream';

    if (download) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(fileRow.name)}"`
      );
      res.setHeader('Content-Type', fileRow.mime_type || 'application/octet-stream');
      return fs.createReadStream(objectPath).pipe(res);
    }

    // HTTP Range support for video/audio scrubbing
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (Number.isNaN(start) || start >= stat.size || end >= stat.size) {
        return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': safeContentType,
      });
      return fs.createReadStream(objectPath, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', safeContentType);
    return fs.createReadStream(objectPath).pipe(res);
  });

  // Safe UTF-8 text preview endpoint
  app.get('/api/files/:id/text', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as any;
    if (!fileRow) return res.status(404).json({ error: 'File not found.' });

    if (fileRow.is_vault === 1) {
      if (fileRow.owner_id !== user.id || !requireVaultToken(req, res)) return;
    } else if (fileRow.owner_id !== user.id) {
      const perm = checkUserSharePermission(user.id, user.email, fileRow);
      if (!perm) return res.status(403).json({ error: 'Access denied.' });
    }

    const objectPath = resolveConfinedStoragePath(STORAGE_OBJECTS_DIR, fileRow.storage_key);
    if (!objectPath || !fs.existsSync(objectPath)) {
      return res.status(404).json({ error: 'Object missing.' });
    }
    const maxBytes = 256 * 1024;
    const buf = fs.readFileSync(objectPath);
    const truncated = buf.length > maxBytes;
    const text = buf.subarray(0, maxBytes).toString('utf8');
    res.json({ text, truncated, sizeBytes: buf.length });
  });

  // --- FILE MUTATIONS & BULK OPS ---
  app.patch('/api/files/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as any;
    if (!fileRow) return res.status(404).json({ error: 'File not found.' });

    const isOwner = fileRow.owner_id === user.id;
    let canEdit = isOwner;
    if (!isOwner) {
      const perm = checkUserSharePermission(user.id, user.email, fileRow);
      canEdit = perm === 'editor';
    }

    const nowIso = new Date().toISOString();

    // Anyone with read access can record last_opened_at
    if (req.body?.markOpened) {
      if (!isOwner && !checkUserSharePermission(user.id, user.email, fileRow)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      if (fileRow.is_vault === 1 && !requireVaultToken(req, res)) return;
      db.prepare('UPDATE files SET last_opened_at = ? WHERE id = ?').run(nowIso, fileRow.id);
      const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(fileRow.id);
      return res.json({ file: serializeFile(updated, user.id, { vaultScope: fileRow.is_vault === 1 }) });
    }

    if (!canEdit) {
      return res.status(403).json({ error: 'You do not have edit permission for this file.' });
    }

    if (fileRow.is_vault === 1 && !requireVaultToken(req, res)) return;

    let name = fileRow.name;
    let folderId = fileRow.folder_id;
    let isFavorite = fileRow.is_favorite;
    let isTrashed = fileRow.is_trashed;
    let trashedAt = fileRow.trashed_at;
    let isVault = fileRow.is_vault;

    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      name = sanitizeDisplayFilename(req.body.name);
    }
    if (req.body?.folderId !== undefined) {
      if (req.body.folderId === null) {
        folderId = null;
      } else if (typeof req.body.folderId === 'string') {
        const fld = db.prepare('SELECT id, owner_id, is_vault FROM folders WHERE id = ?').get(req.body.folderId) as any;
        if (!fld || fld.owner_id !== user.id) {
          return res.status(404).json({ error: 'Destination folder not found.' });
        }
        folderId = fld.id;
        isVault = fld.is_vault;
      }
    }
    if (typeof req.body?.isFavorite === 'boolean') {
      isFavorite = req.body.isFavorite ? 1 : 0;
    }
    if (typeof req.body?.isTrashed === 'boolean') {
      isTrashed = req.body.isTrashed ? 1 : 0;
      trashedAt = req.body.isTrashed ? nowIso : null;
    }
    if (typeof req.body?.isVault === 'boolean' && isOwner) {
      if (!requireVaultToken(req, res)) return;
      isVault = req.body.isVault ? 1 : 0;
      folderId = null;
      if (isVault === 1) {
        // Revoke any shares if moved into Hidden Vault!
        db.prepare(
          `UPDATE shares SET status = 'revoked', revoked_at = ? WHERE resource_type = 'file' AND resource_id = ? AND status != 'revoked'`
        ).run(nowIso, fileRow.id);
        db.prepare('DELETE FROM album_items WHERE file_id = ?').run(fileRow.id);
      }
    }

    db.prepare(
      `UPDATE files SET name = ?, folder_id = ?, is_favorite = ?, is_trashed = ?, trashed_at = ?, is_vault = ?, updated_at = ?
       WHERE id = ?`
    ).run(name, folderId, isFavorite, isTrashed, trashedAt, isVault, nowIso, fileRow.id);

    const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(fileRow.id);
    return res.json({ file: serializeFile(updated, user.id, { vaultScope: isVault === 1 }) });
  });

  app.post('/api/files/bulk', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const action = String(req.body?.action || '');
    const fileIds: string[] = Array.isArray(req.body?.fileIds) ? req.body.fileIds : [];
    const targetFolderId: string | null =
      typeof req.body?.targetFolderId === 'string' && req.body.targetFolderId ? req.body.targetFolderId : null;

    if (fileIds.length === 0) {
      return res.status(400).json({ error: 'No files selected.' });
    }

    if (action === 'move_to_vault' || action === 'remove_from_vault') {
      if (!requireVaultToken(req, res)) return;
    }

    if ((action === 'move' || action === 'copy') && targetFolderId) {
      const targetFolder = db
        .prepare('SELECT id, owner_id, is_vault FROM folders WHERE id = ? AND is_trashed = 0')
        .get(targetFolderId) as any;
      if (!targetFolder || targetFolder.owner_id !== user.id) {
        return res.status(404).json({ error: 'Target folder not found.' });
      }
    }

    const nowIso = new Date().toISOString();
    let affected = 0;

    for (const fid of fileIds) {
      const fileRow = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(fid, user.id) as any;
      if (!fileRow) continue;
      if (fileRow.is_vault === 1 && !verifyVaultToken(req.headers['x-vault-token'] as string | undefined, user.id)) {
        continue;
      }

      if (action === 'trash') {
        db.prepare('UPDATE files SET is_trashed = 1, trashed_at = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, fid);
        affected += 1;
      } else if (action === 'restore') {
        db.prepare('UPDATE files SET is_trashed = 0, trashed_at = NULL, updated_at = ? WHERE id = ?').run(nowIso, fid);
        affected += 1;
      } else if (action === 'delete_permanent') {
        db.prepare('DELETE FROM files WHERE id = ?').run(fid);
        removeUnreferencedStorageObject(fileRow.storage_key);
        affected += 1;
      } else if (action === 'favorite') {
        db.prepare('UPDATE files SET is_favorite = 1, updated_at = ? WHERE id = ?').run(nowIso, fid);
        affected += 1;
      } else if (action === 'unfavorite') {
        db.prepare('UPDATE files SET is_favorite = 0, updated_at = ? WHERE id = ?').run(nowIso, fid);
        affected += 1;
      } else if (action === 'move') {
        db.prepare('UPDATE files SET folder_id = ?, updated_at = ? WHERE id = ?').run(targetFolderId, nowIso, fid);
        affected += 1;
      } else if (action === 'copy') {
        const newId = `fil_${crypto.randomUUID().slice(0, 12)}`;
        const ext = path.extname(fileRow.name);
        const base = path.basename(fileRow.name, ext);
        const copyName = `${base} (Copy)${ext}`;
        db.prepare(
          `INSERT INTO files (
             id, owner_id, folder_id, name, original_name, mime_type, media_kind, size_bytes,
             storage_key, sha256_hash, width, height, duration_sec, taken_at,
             is_vault, is_favorite, is_trashed, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
        ).run(
          newId,
          user.id,
          targetFolderId,
          copyName,
          fileRow.original_name,
          fileRow.mime_type,
          fileRow.media_kind,
          fileRow.size_bytes,
          fileRow.storage_key,
          fileRow.sha256_hash,
          fileRow.width,
          fileRow.height,
          fileRow.duration_sec,
          fileRow.taken_at,
          fileRow.is_vault,
          nowIso,
          nowIso
        );
        affected += 1;
      } else if (action === 'move_to_vault') {
        db.prepare('UPDATE files SET is_vault = 1, folder_id = NULL, updated_at = ? WHERE id = ?').run(nowIso, fid);
        db.prepare(
          `UPDATE shares SET status = 'revoked', revoked_at = ? WHERE resource_type = 'file' AND resource_id = ? AND status != 'revoked'`
        ).run(nowIso, fid);
        db.prepare('DELETE FROM album_items WHERE file_id = ?').run(fid);
        affected += 1;
      } else if (action === 'remove_from_vault') {
        db.prepare('UPDATE files SET is_vault = 0, folder_id = NULL, updated_at = ? WHERE id = ?').run(nowIso, fid);
        affected += 1;
      }
    }

    res.json({ ok: true, affected });
  });

  app.post('/api/files/download-zip', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileIds: string[] = Array.isArray(req.body?.fileIds) ? req.body.fileIds : [];
    const folderIds: string[] = Array.isArray(req.body?.folderIds) ? req.body.folderIds : [];
    const vaultToken = req.headers['x-vault-token'] as string | undefined;
    const hasVault = verifyVaultToken(vaultToken, user.id);

    const entries: Array<{ diskPath: string; archivePath: string }> = [];

    const addFileRow = (fileRow: any, prefix: string) => {
      if (!fileRow || fileRow.is_trashed === 1) return;
      if (fileRow.is_vault === 1 && (!hasVault || fileRow.owner_id !== user.id)) return;
      if (fileRow.owner_id !== user.id && !checkUserSharePermission(user.id, user.email, fileRow)) return;
      const diskPath = resolveConfinedStoragePath(STORAGE_OBJECTS_DIR, fileRow.storage_key);
      if (diskPath && fs.existsSync(diskPath)) {
        entries.push({ diskPath, archivePath: prefix ? `${prefix}/${fileRow.name}` : fileRow.name });
      }
    };

    const collectFolder = (folderId: string, prefix: string, depth = 0) => {
      if (depth > 16) return;
      const fld = db.prepare('SELECT * FROM folders WHERE id = ? AND is_trashed = 0').get(folderId) as any;
      if (!fld) return;
      if (fld.is_vault === 1 && (!hasVault || fld.owner_id !== user.id)) return;
      const nextPrefix = prefix ? `${prefix}/${fld.name}` : fld.name;

      const childFiles = db.prepare('SELECT * FROM files WHERE folder_id = ? AND is_trashed = 0').all(folderId) as any[];
      for (const cf of childFiles) {
        addFileRow(cf, nextPrefix);
      }
      const childFolders = db.prepare('SELECT id FROM folders WHERE parent_id = ? AND is_trashed = 0').all(folderId) as any[];
      for (const sub of childFolders) {
        collectFolder(sub.id, nextPrefix, depth + 1);
      }
    };

    for (const fid of fileIds) {
      const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fid) as any;
      addFileRow(f, '');
    }
    for (const fldId of folderIds) {
      collectFolder(fldId, '');
    }

    if (entries.length === 0) {
      return res.status(404).json({ error: 'No accessible files found to archive.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ASHCLOUD-Archive.zip"');

    const createArchive = (archiverNs as any).default || (archiverNs as any);
    const archive = createArchive('zip', { zlib: { level: 6 } });
    archive.on('error', (err: Error) => {
      console.error('ZIP archive error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    archive.pipe(res);
    for (const entry of entries) {
      archive.file(entry.diskPath, { name: entry.archivePath });
    }
    archive.finalize();
  });

  // --- FOLDERS CRUD ---
  app.post('/api/folders', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const name = sanitizeDisplayFilename(String(req.body?.name || 'New Folder'));
    const parentId = typeof req.body?.parentId === 'string' && req.body.parentId ? req.body.parentId : null;
    const isVault = Boolean(req.body?.isVault);

    if (isVault && !requireVaultToken(req, res)) return;

    if (parentId) {
      const parent = db.prepare('SELECT id, owner_id, is_vault FROM folders WHERE id = ? AND is_trashed = 0').get(parentId) as any;
      if (!parent || parent.owner_id !== user.id) {
        return res.status(404).json({ error: 'Parent folder not found.' });
      }
      if (Boolean(parent.is_vault) !== isVault) {
        return res.status(400).json({ error: 'Parent folder Vault mismatch.' });
      }
    }

    const id = `fld_${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO folders (id, owner_id, parent_id, name, is_vault, is_favorite, is_trashed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
    ).run(id, user.id, parentId, name, isVault ? 1 : 0, nowIso, nowIso);

    if (!isVault) {
      logActivity(user.id, 'created_folder', name, 'folder', 'Drive folder created');
    }

    res.status(201).json({
      folder: {
        id,
        ownerId: user.id,
        parentId,
        name,
        isVault,
        isFavorite: false,
        isTrashed: false,
        trashedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
  });

  app.patch('/api/folders/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fld = db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(req.params.id, user.id) as any;
    if (!fld) return res.status(404).json({ error: 'Folder not found.' });
    if (fld.is_vault === 1 && !requireVaultToken(req, res)) return;

    const nowIso = new Date().toISOString();
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? sanitizeDisplayFilename(req.body.name) : fld.name;
    const isFavorite = typeof req.body?.isFavorite === 'boolean' ? (req.body.isFavorite ? 1 : 0) : fld.is_favorite;
    const isTrashed = typeof req.body?.isTrashed === 'boolean' ? (req.body.isTrashed ? 1 : 0) : fld.is_trashed;
    const trashedAt = typeof req.body?.isTrashed === 'boolean' ? (req.body.isTrashed ? nowIso : null) : fld.trashed_at;
    let parentId = fld.parent_id;
    if (req.body?.parentId !== undefined) {
      if (req.body.parentId === fld.id) {
        return res.status(400).json({ error: 'Cannot move a folder into itself.' });
      }
      parentId = req.body.parentId || null;
    }

    db.prepare(
      `UPDATE folders SET name = ?, parent_id = ?, is_favorite = ?, is_trashed = ?, trashed_at = ?, updated_at = ? WHERE id = ?`
    ).run(name, parentId, isFavorite, isTrashed, trashedAt, nowIso, fld.id);

    if (typeof req.body?.isTrashed === 'boolean') {
      db.prepare('UPDATE files SET is_trashed = ?, trashed_at = ?, updated_at = ? WHERE folder_id = ? AND owner_id = ?').run(
        isTrashed,
        trashedAt,
        nowIso,
        fld.id,
        user.id
      );
    }

    res.json({
      folder: {
        id: fld.id,
        ownerId: fld.owner_id,
        parentId,
        name,
        isVault: Boolean(fld.is_vault),
        isFavorite: Boolean(isFavorite),
        isTrashed: Boolean(isTrashed),
        trashedAt,
        createdAt: fld.created_at,
        updatedAt: nowIso,
      },
    });
  });

  app.delete('/api/folders/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fld = db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(req.params.id, user.id) as any;
    if (!fld) return res.status(404).json({ error: 'Folder not found.' });
    if (fld.is_vault === 1 && !requireVaultToken(req, res)) return;

    const collectAllFiles = (folderId: string): string[] => {
      const fileRows = db.prepare('SELECT storage_key FROM files WHERE folder_id = ? AND owner_id = ?').all(folderId, user.id) as Array<{ storage_key: string }>;
      const keys = fileRows.map((r) => r.storage_key);
      const subFolders = db.prepare('SELECT id FROM folders WHERE parent_id = ? AND owner_id = ?').all(folderId, user.id) as Array<{ id: string }>;
      for (const sf of subFolders) {
        keys.push(...collectAllFiles(sf.id));
      }
      return keys;
    };

    const keys = collectAllFiles(fld.id);
    db.prepare('DELETE FROM files WHERE folder_id = ? AND owner_id = ?').run(fld.id, user.id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(fld.id);
    for (const k of keys) {
      removeUnreferencedStorageObject(k);
    }
    res.json({ ok: true });
  });

  // --- ALBUMS ---
  app.post('/api/albums', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Album title is required.' });
    const description = String(req.body?.description || '').trim();
    const fileIds: string[] = Array.isArray(req.body?.fileIds) ? req.body.fileIds : [];
    const id = `alb_${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();

    const validFileIds: string[] = [];
    for (const fid of fileIds) {
      const f = db
        .prepare('SELECT id FROM files WHERE id = ? AND owner_id = ? AND is_vault = 0 AND is_trashed = 0')
        .get(fid, user.id) as { id: string } | undefined;
      if (f) validFileIds.push(f.id);
    }

    const coverFileId = validFileIds[0] || null;
    db.prepare(
      `INSERT INTO albums (id, owner_id, title, description, cover_file_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, user.id, title, description, coverFileId, nowIso, nowIso);

    const insertItem = db.prepare('INSERT OR IGNORE INTO album_items (album_id, file_id, added_at) VALUES (?, ?, ?)');
    for (const fid of validFileIds) {
      insertItem.run(id, fid, nowIso);
    }

    logActivity(user.id, 'created_album', title, 'album', `${validFileIds.length} items`);
    res.status(201).json({
      album: {
        id,
        ownerId: user.id,
        title,
        description,
        coverFileId,
        fileIds: validFileIds,
        itemCount: validFileIds.length,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
  });

  app.patch('/api/albums/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND owner_id = ?').get(req.params.id, user.id) as any;
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : album.title;
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : album.description;
    const coverFileId = req.body?.coverFileId !== undefined ? req.body.coverFileId : album.cover_file_id;
    const nowIso = new Date().toISOString();

    db.prepare('UPDATE albums SET title = ?, description = ?, cover_file_id = ?, updated_at = ? WHERE id = ?').run(
      title,
      description,
      coverFileId,
      nowIso,
      album.id
    );
    res.json({ ok: true });
  });

  app.delete('/api/albums/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    db.prepare('DELETE FROM albums WHERE id = ? AND owner_id = ?').run(req.params.id, user.id);
    res.json({ ok: true });
  });

  app.post('/api/albums/:id/items', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND owner_id = ?').get(req.params.id, user.id) as any;
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    const fileIds: string[] = Array.isArray(req.body?.fileIds) ? req.body.fileIds : [];
    const nowIso = new Date().toISOString();
    const insertItem = db.prepare('INSERT OR IGNORE INTO album_items (album_id, file_id, added_at) VALUES (?, ?, ?)');
    let added = 0;

    for (const fid of fileIds) {
      const f = db
        .prepare('SELECT id FROM files WHERE id = ? AND owner_id = ? AND is_vault = 0 AND is_trashed = 0')
        .get(fid, user.id);
      if (f) {
        insertItem.run(album.id, fid, nowIso);
        added += 1;
        if (!album.cover_file_id) {
          db.prepare('UPDATE albums SET cover_file_id = ? WHERE id = ?').run(fid, album.id);
          album.cover_file_id = fid;
        }
      }
    }
    db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(nowIso, album.id);
    res.json({ ok: true, added });
  });

  app.delete('/api/albums/:id/items/:fileId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const album = db.prepare('SELECT * FROM albums WHERE id = ? AND owner_id = ?').get(req.params.id, user.id) as any;
    if (!album) return res.status(404).json({ error: 'Album not found.' });
    db.prepare('DELETE FROM album_items WHERE album_id = ? AND file_id = ?').run(album.id, req.params.fileId);
    res.json({ ok: true });
  });

  // --- HIDDEN VAULT ---
  app.get('/api/vault/status', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const vaultToken = req.headers['x-vault-token'] as string | undefined;
    res.json({
      hasPin: Boolean(user.vault_pin_hash),
      unlocked: Boolean(user.vault_pin_hash && verifyVaultToken(vaultToken, user.id)),
      autoLockMinutes: user.vault_auto_lock_minutes,
    });
  });

  app.post('/api/vault/setup', requireAuth, authLimiter, (req: AuthedRequest, res) => {
    const user = req.user!;
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ error: 'Vault PIN must be 4 to 8 digits.' });
    }
    if (user.vault_pin_hash) {
      return res.status(409).json({ error: 'Vault PIN is already configured. Use change PIN instead.' });
    }

    const pinHash = hashSecret(pin);
    db.prepare('UPDATE users SET vault_pin_hash = ? WHERE id = ?').run(pinHash, user.id);
    const { token, expiresAt } = createVaultToken(user.id, user.vault_auto_lock_minutes);
    logActivity(user.id, 'configured_vault', 'Hidden Vault', 'vault', 'PIN protection enabled');
    res.json({ vaultToken: token, expiresAt });
  });

  app.post('/api/vault/unlock', requireAuth, authLimiter, (req: AuthedRequest, res) => {
    const user = req.user!;
    const pin = String(req.body?.pin || '').trim();
    if (!user.vault_pin_hash) {
      return res.status(400).json({ error: 'Vault PIN not set yet.' });
    }
    if (!verifySecret(pin, user.vault_pin_hash)) {
      return res.status(401).json({ error: 'Incorrect Vault PIN.' });
    }
    const { token, expiresAt } = createVaultToken(user.id, user.vault_auto_lock_minutes);
    res.json({ vaultToken: token, expiresAt });
  });

  app.post('/api/vault/change-pin', requireAuth, authLimiter, (req: AuthedRequest, res) => {
    const user = req.user!;
    const currentPin = String(req.body?.currentPin || '').trim();
    const newPin = String(req.body?.newPin || '').trim();
    if (!user.vault_pin_hash || !verifySecret(currentPin, user.vault_pin_hash)) {
      return res.status(401).json({ error: 'Current Vault PIN is incorrect.' });
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      return res.status(400).json({ error: 'New Vault PIN must be 4 to 8 digits.' });
    }
    db.prepare('UPDATE users SET vault_pin_hash = ? WHERE id = ?').run(hashSecret(newPin), user.id);
    const { token, expiresAt } = createVaultToken(user.id, user.vault_auto_lock_minutes);
    res.json({ ok: true, vaultToken: token, expiresAt });
  });

  app.get('/api/vault/items', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!requireVaultToken(req, res)) return;

    const files = db
      .prepare('SELECT * FROM files WHERE owner_id = ? AND is_vault = 1 AND is_trashed = 0 ORDER BY created_at DESC')
      .all(user.id) as any[];
    const folders = db
      .prepare('SELECT * FROM folders WHERE owner_id = ? AND is_vault = 1 AND is_trashed = 0 ORDER BY name ASC')
      .all(user.id) as any[];

    res.json({
      files: files.map((f) => serializeFile(f, user.id, { vaultScope: true, ownerName: user.name, ownerEmail: user.email })),
      folders: folders.map((fld) => ({
        id: fld.id,
        ownerId: fld.owner_id,
        parentId: fld.parent_id,
        name: fld.name,
        isVault: true,
        isFavorite: Boolean(fld.is_favorite),
        isTrashed: false,
        createdAt: fld.created_at,
        updatedAt: fld.updated_at,
      })),
    });
  });

  // --- SHARING SYSTEM ---
  app.get('/api/shares/with-me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const nowIso = new Date().toISOString();

    const rows = db
      .prepare(
        `SELECT s.*, u.name AS owner_name, u.email AS owner_email
         FROM shares s
         JOIN users u ON u.id = s.owner_id
         WHERE (s.recipient_id = ? OR LOWER(s.recipient_email) = LOWER(?))
           AND s.status IN ('pending', 'accepted')
           AND (s.expires_at IS NULL OR s.expires_at > ?)
         ORDER BY s.created_at DESC`
      )
      .all(user.id, user.email, nowIso) as any[];

    const items: any[] = [];
    for (const s of rows) {
      if (s.resource_type === 'file') {
        const f = db
          .prepare('SELECT * FROM files WHERE id = ? AND is_vault = 0 AND is_trashed = 0')
          .get(s.resource_id) as any;
        if (!f) continue;
        items.push({
          shareId: s.id,
          status: s.status,
          permission: s.permission,
          allowCopy: Boolean(s.allow_copy ?? 1),
          resourceType: 'file',
          resourceId: f.id,
          ownerName: s.owner_name,
          ownerEmail: s.owner_email,
          sharedAt: s.created_at,
          expiresAt: s.expires_at,
          file:
            s.status === 'accepted'
              ? serializeFile(f, user.id, {
                  permission: s.permission,
                  ownerName: s.owner_name,
                  ownerEmail: s.owner_email,
                  allowCopy: Boolean(s.allow_copy ?? 1),
                })
              : {
                  id: f.id,
                  name: f.name,
                  mediaKind: f.media_kind,
                  sizeBytes: f.size_bytes,
                  mimeType: f.mime_type,
                },
        });
      } else if (s.resource_type === 'folder') {
        const fld = db
          .prepare('SELECT * FROM folders WHERE id = ? AND is_vault = 0 AND is_trashed = 0')
          .get(s.resource_id) as any;
        if (!fld) continue;
        const folderFiles =
          s.status === 'accepted'
            ? (db
                .prepare('SELECT * FROM files WHERE folder_id = ? AND is_vault = 0 AND is_trashed = 0 ORDER BY name ASC')
                .all(fld.id) as any[])
            : [];
        items.push({
          shareId: s.id,
          status: s.status,
          permission: s.permission,
          allowCopy: Boolean(s.allow_copy ?? 1),
          resourceType: 'folder',
          resourceId: fld.id,
          ownerName: s.owner_name,
          ownerEmail: s.owner_email,
          sharedAt: s.created_at,
          expiresAt: s.expires_at,
          folder: {
            id: fld.id,
            name: fld.name,
            createdAt: fld.created_at,
            files: folderFiles.map((f) =>
              serializeFile(f, user.id, {
                permission: s.permission,
                ownerName: s.owner_name,
                ownerEmail: s.owner_email,
                allowCopy: Boolean(s.allow_copy ?? 1),
              })
            ),
          },
        });
      } else if (s.resource_type === 'album') {
        const alb = db.prepare('SELECT * FROM albums WHERE id = ?').get(s.resource_id) as any;
        if (!alb) continue;
        const albFiles =
          s.status === 'accepted'
            ? (db
                .prepare(
                  `SELECT f.* FROM files f
                   JOIN album_items ai ON ai.file_id = f.id
                   WHERE ai.album_id = ? AND f.is_vault = 0 AND f.is_trashed = 0`
                )
                .all(alb.id) as any[])
            : [];
        items.push({
          shareId: s.id,
          status: s.status,
          permission: s.permission,
          allowCopy: Boolean(s.allow_copy ?? 1),
          resourceType: 'album',
          resourceId: alb.id,
          ownerName: s.owner_name,
          ownerEmail: s.owner_email,
          sharedAt: s.created_at,
          expiresAt: s.expires_at,
          album: {
            id: alb.id,
            title: alb.title,
            description: alb.description,
            files: albFiles.map((f) =>
              serializeFile(f, user.id, {
                permission: s.permission,
                ownerName: s.owner_name,
                ownerEmail: s.owner_email,
                allowCopy: Boolean(s.allow_copy ?? 1),
              })
            ),
          },
        });
      }
    }

    res.json({ shares: items });
  });

  app.get('/api/shares/by-me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare(
        `SELECT s.*, u.name AS recipient_name
         FROM shares s
         LEFT JOIN users u ON u.id = s.recipient_id
         WHERE s.owner_id = ?
         ORDER BY s.created_at DESC`
      )
      .all(user.id) as any[];

    const nowMs = Date.now();
    const shares = rows.map((s) => {
      let resourceName = 'Untitled';
      let mediaKind: string | null = null;
      if (s.resource_type === 'file') {
        const f = db.prepare('SELECT name, media_kind FROM files WHERE id = ?').get(s.resource_id) as any;
        resourceName = f?.name || 'Deleted file';
        mediaKind = f?.media_kind || null;
      } else if (s.resource_type === 'folder') {
        const fld = db.prepare('SELECT name FROM folders WHERE id = ?').get(s.resource_id) as any;
        resourceName = fld?.name || 'Deleted folder';
      } else if (s.resource_type === 'album') {
        const alb = db.prepare('SELECT title FROM albums WHERE id = ?').get(s.resource_id) as any;
        resourceName = alb?.title || 'Deleted album';
      }

      const isExpired = Boolean(s.expires_at && new Date(s.expires_at).getTime() <= nowMs);
      return {
        id: s.id,
        resourceType: s.resource_type,
        resourceId: s.resource_id,
        resourceName,
        mediaKind,
        recipientEmail: s.recipient_email,
        recipientName: s.recipient_name,
        permission: s.permission,
        status: isExpired && s.status !== 'revoked' ? 'expired' : s.status,
        shareToken: s.share_token,
        isLinkPublic: Boolean(s.is_link_public),
        hasPassword: Boolean(s.password_hash),
        expiresAt: s.expires_at,
        createdAt: s.created_at,
        revokedAt: s.revoked_at,
      };
    });

    res.json({ shares });
  });

  app.post('/api/shares', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const resourceType = req.body?.resourceType;
    const resourceId = String(req.body?.resourceId || '');
    const permission = ['viewer', 'commenter', 'editor'].includes(req.body?.permission)
      ? req.body.permission
      : 'viewer';
    const recipientEmail = req.body?.recipientEmail ? String(req.body.recipientEmail).trim().toLowerCase() : null;
    const isLinkPublic = Boolean(req.body?.isLinkPublic);
    const allowCopy = req.body?.allowCopy !== false;
    const password = typeof req.body?.password === 'string' && req.body.password.trim() ? req.body.password.trim() : null;
    const expiresAt = typeof req.body?.expiresAt === 'string' && req.body.expiresAt ? req.body.expiresAt : null;

    if (!['file', 'folder', 'album'].includes(resourceType) || !resourceId) {
      return res.status(400).json({ error: 'Invalid resource to share.' });
    }
    if (!isLinkPublic && !recipientEmail) {
      return res.status(400).json({ error: 'Provide a recipient email or enable Anyone With Link.' });
    }

    let resourceName = '';
    if (resourceType === 'file') {
      const f = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(resourceId, user.id) as any;
      if (!f) return res.status(404).json({ error: 'File not found.' });
      if (f.is_vault === 1) {
        return res.status(403).json({ error: 'Hidden Vault items cannot be shared.' });
      }
      resourceName = f.name;
    } else if (resourceType === 'folder') {
      const fld = db.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').get(resourceId, user.id) as any;
      if (!fld) return res.status(404).json({ error: 'Folder not found.' });
      if (fld.is_vault === 1) {
        return res.status(403).json({ error: 'Hidden Vault folders cannot be shared.' });
      }
      resourceName = fld.name;
    } else {
      const alb = db.prepare('SELECT * FROM albums WHERE id = ? AND owner_id = ?').get(resourceId, user.id) as any;
      if (!alb) return res.status(404).json({ error: 'Album not found.' });
      resourceName = alb.title;
    }

    let recipientUser: AuthUser | undefined;
    if (recipientEmail) {
      if (recipientEmail === user.email.toLowerCase()) {
        return res.status(400).json({ error: 'You cannot share an item with yourself.' });
      }
      recipientUser = db
        .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
        .get(recipientEmail) as AuthUser | undefined;
    }

    const shareId = `shr_${crypto.randomUUID().slice(0, 12)}`;
    const shareToken = generateOpaqueToken(24);
    const nowIso = new Date().toISOString();
    const initialStatus = isLinkPublic && !recipientEmail ? 'accepted' : 'pending';

    db.prepare(
      `INSERT INTO shares (
         id, owner_id, recipient_id, recipient_email, resource_type, resource_id,
         permission, status, share_token, is_link_public, allow_copy, password_hash, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      shareId,
      user.id,
      recipientUser?.id || null,
      recipientEmail,
      resourceType,
      resourceId,
      permission,
      initialStatus,
      shareToken,
      isLinkPublic ? 1 : 0,
      allowCopy ? 1 : 0,
      password ? hashSecret(password) : null,
      expiresAt,
      nowIso
    );

    if (recipientUser) {
      createNotification(
        recipientUser.id,
        'share_invite',
        'New sharing invitation',
        `${user.name} invited you as ${permission} for "${resourceName}".`,
        resourceType,
        resourceId
      );
    }

    logActivity(
      user.id,
      'shared',
      resourceName,
      resourceType,
      recipientEmail ? `Invited ${recipientEmail} (${permission})` : `Created public link (${permission})`
    );

    res.status(201).json({
      share: {
        id: shareId,
        shareToken,
        status: initialStatus,
        permission,
        resourceType,
        resourceId,
        resourceName,
        recipientEmail,
        isLinkPublic,
        hasPassword: Boolean(password),
        expiresAt,
        createdAt: nowIso,
      },
    });
  });

  app.post('/api/shares/:id/respond', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const decision = req.body?.decision;
    if (decision !== 'accept' && decision !== 'reject') {
      return res.status(400).json({ error: 'Invalid decision.' });
    }
    const share = db
      .prepare(
        `SELECT * FROM shares
         WHERE id = ? AND (recipient_id = ? OR LOWER(recipient_email) = LOWER(?)) AND status = 'pending'`
      )
      .get(req.params.id, user.id, user.email) as any;

    if (!share) return res.status(404).json({ error: 'Invitation not found or already handled.' });

    const newStatus = decision === 'accept' ? 'accepted' : 'rejected';
    db.prepare('UPDATE shares SET status = ?, recipient_id = ? WHERE id = ?').run(newStatus, user.id, share.id);

    createNotification(
      share.owner_id,
      'share_response',
      decision === 'accept' ? 'Invitation accepted' : 'Invitation declined',
      `${user.name} ${decision === 'accept' ? 'accepted' : 'declined'} your share invitation.`,
      share.resource_type,
      share.resource_id
    );

    res.json({ ok: true, status: newStatus });
  });

  app.patch('/api/shares/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const share = db.prepare('SELECT * FROM shares WHERE id = ? AND owner_id = ?').get(req.params.id, user.id) as any;
    if (!share) return res.status(404).json({ error: 'Share record not found.' });

    const permission = ['viewer', 'commenter', 'editor'].includes(req.body?.permission)
      ? req.body.permission
      : share.permission;
    const expiresAt = req.body?.expiresAt !== undefined ? req.body.expiresAt || null : share.expires_at;
    const isLinkPublic = typeof req.body?.isLinkPublic === 'boolean' ? (req.body.isLinkPublic ? 1 : 0) : share.is_link_public;

    db.prepare('UPDATE shares SET permission = ?, expires_at = ?, is_link_public = ? WHERE id = ?').run(
      permission,
      expiresAt,
      isLinkPublic,
      share.id
    );

    if (req.body?.resend && share.recipient_id) {
      createNotification(
        share.recipient_id,
        'share_invite',
        'Sharing invitation reminder',
        `${user.name} resent a sharing invitation for a ${share.resource_type}.`,
        share.resource_type,
        share.resource_id
      );
    }

    res.json({ ok: true });
  });

  app.post('/api/shares/:id/revoke', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const share = db.prepare('SELECT * FROM shares WHERE id = ? AND owner_id = ?').get(req.params.id, user.id) as any;
    if (!share) return res.status(404).json({ error: 'Share record not found.' });

    const nowIso = new Date().toISOString();
    db.prepare(`UPDATE shares SET status = 'revoked', revoked_at = ? WHERE id = ?`).run(nowIso, share.id);
    db.prepare('DELETE FROM saved_shared_items WHERE share_id = ?').run(share.id);

    if (share.recipient_id) {
      createNotification(
        share.recipient_id,
        'share_revoked',
        'Shared access revoked',
        `${user.name} revoked access to a shared ${share.resource_type}.`,
        share.resource_type,
        share.resource_id
      );
    }

    res.json({ ok: true });
  });

  // --- SAVE SHARED PHOTOS/VIDEOS TO MY PHOTOS (REFERENCE OR INDEPENDENT COPY) ---
  app.post('/api/shares/save-to-photos', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileId = String(req.body?.fileId || '').trim();
    const mode = req.body?.mode === 'copy' ? 'copy' : 'reference';

    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId.' });
    }

    const fileRow = db
      .prepare('SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE f.id = ?')
      .get(fileId) as any;
    if (!fileRow || fileRow.is_vault === 1 || fileRow.is_trashed === 1) {
      return res.status(404).json({ error: 'Shared media item is no longer available.' });
    }
    if (fileRow.owner_id === user.id) {
      return res.status(400).json({ error: 'This item is already in your own library.' });
    }
    if (fileRow.media_kind !== 'photo' && fileRow.media_kind !== 'video') {
      return res.status(400).json({ error: 'Only shared photos and videos can be saved to My Photos.' });
    }

    const nowIso = new Date().toISOString();
    // Locate the matching accepted, active share row
    const directShare = db
      .prepare(
        `SELECT * FROM shares
         WHERE resource_type = 'file' AND resource_id = ? AND status = 'accepted'
           AND (recipient_id = ? OR LOWER(recipient_email) = LOWER(?))
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`
      )
      .get(fileRow.id, user.id, user.email, nowIso) as any;

    let activeShare = directShare;
    if (!activeShare && fileRow.folder_id) {
      const ancestorIds = getFolderAncestors(fileRow.folder_id);
      if (ancestorIds.length > 0) {
        const placeholders = ancestorIds.map(() => '?').join(',');
        activeShare = db
          .prepare(
            `SELECT * FROM shares
             WHERE resource_type = 'folder' AND resource_id IN (${placeholders}) AND status = 'accepted'
               AND (recipient_id = ? OR LOWER(recipient_email) = LOWER(?))
               AND (expires_at IS NULL OR expires_at > ?)
             LIMIT 1`
          )
          .get(...ancestorIds, user.id, user.email, nowIso);
      }
    }
    if (!activeShare) {
      activeShare = db
        .prepare(
          `SELECT s.* FROM shares s JOIN album_items ai ON ai.album_id = s.resource_id
           WHERE s.resource_type = 'album' AND ai.file_id = ? AND s.status = 'accepted'
             AND (s.recipient_id = ? OR LOWER(s.recipient_email) = LOWER(?))
             AND (s.expires_at IS NULL OR s.expires_at > ?)
           LIMIT 1`
        )
        .get(fileRow.id, user.id, user.email, nowIso);
    }

    if (!activeShare) {
      return res.status(403).json({ error: 'Sharing permission missing, expired, or revoked.' });
    }

    if (mode === 'reference') {
      const existingRef = db
        .prepare('SELECT id FROM saved_shared_items WHERE user_id = ? AND file_id = ?')
        .get(user.id, fileRow.id) as { id: string } | undefined;

      if (!existingRef) {
        db.prepare(
          `INSERT INTO saved_shared_items (id, user_id, share_id, file_id, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(`ssi_${crypto.randomUUID().slice(0, 12)}`, user.id, activeShare.id, fileRow.id, nowIso);
        logActivity(user.id, 'saved_shared_ref', fileRow.name, fileRow.media_kind, `Linked from ${fileRow.owner_name}`);
      }

      return res.status(201).json({
        mode: 'reference',
        file: serializeFile(fileRow, user.id, {
          ownerName: fileRow.owner_name,
          permission: activeShare.permission,
          savedMode: 'reference',
          savedShareId: activeShare.id,
          allowCopy: Boolean(activeShare.allow_copy ?? 1),
        }),
      });
    }

    // mode === 'copy': Create an independent copy owned by recipient (respecting allow_copy)
    if (Number(activeShare.allow_copy ?? 1) !== 1) {
      return res.status(403).json({
        error: 'The owner disabled independent copying for this share. You can still save it as a Shared Reference.',
      });
    }

    const disk = getRealDiskStats();
    if (disk.provisionedAvailableBytes > 0 && fileRow.size_bytes > disk.provisionedAvailableBytes) {
      return res.status(507).json({ error: 'Insufficient storage capacity to save an independent copy.' });
    }

    // Physical object stays deduplicated via storage_key reference-counting, while user's storage accounting records actual size_bytes
    const existingCopy = db
      .prepare(
        `SELECT * FROM files WHERE owner_id = ? AND source_provider = 'shared_copy' AND external_id = ? AND is_trashed = 0`
      )
      .get(user.id, fileRow.id) as any;

    if (existingCopy) {
      return res.json({
        alreadyCopied: true,
        mode: 'copy',
        file: serializeFile(existingCopy, user.id, { ownerName: user.name, ownerEmail: user.email }),
      });
    }

    const newId = `fil_${crypto.randomUUID().slice(0, 12)}`;
    db.prepare(
      `INSERT INTO files (
         id, owner_id, folder_id, name, original_name, mime_type, media_kind, size_bytes,
         storage_key, sha256_hash, width, height, duration_sec, taken_at,
         is_vault, is_favorite, is_trashed, source_provider, external_id, copied_from_share_id, copied_from_owner_name,
         created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'shared_copy', ?, ?, ?, ?, ?)`
    ).run(
      newId,
      user.id,
      fileRow.name,
      fileRow.original_name,
      fileRow.mime_type,
      fileRow.media_kind,
      fileRow.size_bytes,
      fileRow.storage_key,
      fileRow.sha256_hash,
      fileRow.width,
      fileRow.height,
      fileRow.duration_sec,
      fileRow.taken_at || fileRow.created_at,
      fileRow.id,
      activeShare.id,
      fileRow.owner_name,
      nowIso,
      nowIso
    );

    const created = db.prepare('SELECT * FROM files WHERE id = ?').get(newId) as any;
    logActivity(user.id, 'saved_shared_copy', fileRow.name, fileRow.media_kind, `Copied from ${fileRow.owner_name}`);
    return res.status(201).json({
      mode: 'copy',
      file: serializeFile(created, user.id, { ownerName: user.name, ownerEmail: user.email }),
    });
  });

  app.delete('/api/shares/saved-reference/:fileId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    db.prepare('DELETE FROM saved_shared_items WHERE user_id = ? AND file_id = ?').run(user.id, req.params.fileId);
    res.json({ ok: true });
  });

  // --- PUBLIC SHARE LINK VIEW ---
  function loadPublicSharePayload(share: any) {
    const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(share.owner_id) as { name: string; email: string } | undefined;
    if (share.resource_type === 'file') {
      const f = db.prepare('SELECT * FROM files WHERE id = ? AND is_vault = 0 AND is_trashed = 0').get(share.resource_id) as any;
      if (!f) return null;
      return {
        shareId: share.id,
        resourceType: 'file',
        permission: share.permission,
        ownerName: owner?.name || 'ASHCLOUD User',
        expiresAt: share.expires_at,
        file: serializeFile(f, share.owner_id, {
          shareToken: share.share_token,
          permission: share.permission,
          ownerName: owner?.name,
        }),
      };
    }
    if (share.resource_type === 'folder') {
      const fld = db.prepare('SELECT * FROM folders WHERE id = ? AND is_vault = 0 AND is_trashed = 0').get(share.resource_id) as any;
      if (!fld) return null;
      const files = db.prepare('SELECT * FROM files WHERE folder_id = ? AND is_vault = 0 AND is_trashed = 0').all(fld.id) as any[];
      return {
        shareId: share.id,
        resourceType: 'folder',
        permission: share.permission,
        ownerName: owner?.name || 'ASHCLOUD User',
        expiresAt: share.expires_at,
        folder: {
          id: fld.id,
          name: fld.name,
          files: files.map((f) =>
            serializeFile(f, share.owner_id, {
              shareToken: share.share_token,
              permission: share.permission,
              ownerName: owner?.name,
            })
          ),
        },
      };
    }
    const alb = db.prepare('SELECT * FROM albums WHERE id = ?').get(share.resource_id) as any;
    if (!alb) return null;
    const files = db
      .prepare(
        `SELECT f.* FROM files f JOIN album_items ai ON ai.file_id = f.id
         WHERE ai.album_id = ? AND f.is_vault = 0 AND f.is_trashed = 0`
      )
      .all(alb.id) as any[];
    return {
      shareId: share.id,
      resourceType: 'album',
      permission: share.permission,
      ownerName: owner?.name || 'ASHCLOUD User',
      expiresAt: share.expires_at,
      album: {
        id: alb.id,
        title: alb.title,
        description: alb.description,
        files: files.map((f) =>
          serializeFile(f, share.owner_id, {
            shareToken: share.share_token,
            permission: share.permission,
            ownerName: owner?.name,
          })
        ),
      },
    };
  }

  app.get('/api/public/share/:token', (req, res) => {
    const share = db.prepare('SELECT * FROM shares WHERE share_token = ?').get(req.params.token) as any;
    if (!share || !share.is_link_public || share.status === 'revoked') {
      return res.status(404).json({ error: 'Share link is invalid or has been revoked.' });
    }
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ error: 'This share link has expired.' });
    }
    if (share.password_hash) {
      return res.json({ requiresPassword: true, resourceType: share.resource_type });
    }
    const payload = loadPublicSharePayload(share);
    if (!payload) return res.status(404).json({ error: 'Shared resource is no longer available.' });
    return res.json(payload);
  });

  app.post('/api/public/share/:token/verify', authLimiter, (req, res) => {
    const share = db.prepare('SELECT * FROM shares WHERE share_token = ?').get(req.params.token) as any;
    if (!share || !share.is_link_public || share.status === 'revoked') {
      return res.status(404).json({ error: 'Share link is invalid or revoked.' });
    }
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ error: 'This share link has expired.' });
    }
    const password = String(req.body?.password || '');
    if (!verifySecret(password, share.password_hash)) {
      return res.status(401).json({ error: 'Incorrect share link password.' });
    }
    const payload = loadPublicSharePayload(share);
    if (!payload) return res.status(404).json({ error: 'Shared resource is no longer available.' });
    return res.json(payload);
  });

  // --- COMMENTS ---
  app.get('/api/comments/:fileId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ? AND is_vault = 0').get(req.params.fileId) as any;
    if (!fileRow) return res.status(404).json({ error: 'File not found.' });
    if (fileRow.owner_id !== user.id && !checkUserSharePermission(user.id, user.email, fileRow)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const rows = db
      .prepare(
        `SELECT c.*, u.name AS author_name, u.avatar_url AS author_avatar
         FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.file_id = ? ORDER BY c.created_at ASC`
      )
      .all(fileRow.id) as any[];

    res.json({
      comments: rows.map((r) => ({
        id: r.id,
        fileId: r.file_id,
        authorName: r.author_name,
        authorAvatar: r.author_avatar,
        body: r.body,
        createdAt: r.created_at,
      })),
    });
  });

  app.post('/api/comments/:fileId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ? AND is_vault = 0').get(req.params.fileId) as any;
    if (!fileRow) return res.status(404).json({ error: 'File not found.' });
    const perm = fileRow.owner_id === user.id ? 'editor' : checkUserSharePermission(user.id, user.email, fileRow);
    if (!perm || perm === 'viewer') {
      return res.status(403).json({ error: 'Commenter or Editor permission required.' });
    }
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });

    const id = `cmt_${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    db.prepare('INSERT INTO comments (id, file_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      fileRow.id,
      user.id,
      body,
      nowIso
    );

    if (fileRow.owner_id !== user.id) {
      createNotification(
        fileRow.owner_id,
        'comment',
        'New comment on shared file',
        `${user.name} commented on "${fileRow.name}": ${body.slice(0, 80)}`,
        'file',
        fileRow.id
      );
    }

    res.status(201).json({
      comment: {
        id,
        fileId: fileRow.id,
        authorName: user.name,
        authorAvatar: user.avatar_url,
        body,
        createdAt: nowIso,
      },
    });
  });

  // --- GLOBAL SEARCH (Owned + Accepted Shared, excluding Vault & Trash) ---
  app.get('/api/search', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const q = String(req.query.q || '').trim().toLowerCase();
    const typeFilter = String(req.query.type || 'all');
    const scopeFilter = String(req.query.scope || 'all'); // all | mine | shared | favorites
    const nowIso = new Date().toISOString();

    const results: any[] = [];

    // 1. User's own non-vault, non-trashed files
    if (scopeFilter !== 'shared') {
      const ownFiles = db
        .prepare(
          `SELECT * FROM files
           WHERE owner_id = ? AND is_vault = 0 AND is_trashed = 0
             ${scopeFilter === 'favorites' ? 'AND is_favorite = 1' : ''}
             ${q ? 'AND LOWER(name) LIKE ?' : ''}
           ORDER BY updated_at DESC LIMIT 60`
        )
        .all(...(q ? [user.id, `%${q}%`] : [user.id])) as any[];

      for (const f of ownFiles) {
        if (typeFilter !== 'all' && typeFilter !== f.media_kind) continue;
        results.push({
          resultType: 'file',
          location: f.media_kind === 'photo' || f.media_kind === 'video' ? 'My Photos' : 'My Drive',
          sharingStatus: 'Private',
          item: serializeFile(f, user.id, { ownerName: user.name, ownerEmail: user.email }),
        });
      }

      if (typeFilter === 'all' || typeFilter === 'folder') {
        const ownFolders = db
          .prepare(
            `SELECT * FROM folders
             WHERE owner_id = ? AND is_vault = 0 AND is_trashed = 0
               ${scopeFilter === 'favorites' ? 'AND is_favorite = 1' : ''}
               ${q ? 'AND LOWER(name) LIKE ?' : ''}
             ORDER BY name ASC LIMIT 30`
          )
          .all(...(q ? [user.id, `%${q}%`] : [user.id])) as any[];
        for (const fld of ownFolders) {
          results.push({
            resultType: 'folder',
            location: 'My Drive',
            sharingStatus: 'Private',
            ownerName: user.name,
            item: {
              id: fld.id,
              name: fld.name,
              parentId: fld.parent_id,
              createdAt: fld.created_at,
            },
          });
        }
      }

      if ((typeFilter === 'all' || typeFilter === 'album') && scopeFilter !== 'favorites') {
        const ownAlbums = db
          .prepare(
            `SELECT * FROM albums WHERE owner_id = ? ${q ? 'AND LOWER(title) LIKE ?' : ''} ORDER BY updated_at DESC LIMIT 20`
          )
          .all(...(q ? [user.id, `%${q}%`] : [user.id])) as any[];
        for (const alb of ownAlbums) {
          results.push({
            resultType: 'album',
            location: 'Albums',
            sharingStatus: 'Private',
            ownerName: user.name,
            item: {
              id: alb.id,
              title: alb.title,
              description: alb.description,
              createdAt: alb.created_at,
            },
          });
        }
      }
    }

    // 2. Accepted Shared With Me content
    if (scopeFilter === 'all' || scopeFilter === 'shared') {
      const acceptedShares = db
        .prepare(
          `SELECT s.*, u.name AS owner_name, u.email AS owner_email
           FROM shares s JOIN users u ON u.id = s.owner_id
           WHERE (s.recipient_id = ? OR LOWER(s.recipient_email) = LOWER(?))
             AND s.status = 'accepted'
             AND (s.expires_at IS NULL OR s.expires_at > ?)`
        )
        .all(user.id, user.email, nowIso) as any[];

      const seenSharedFiles = new Set<string>();
      for (const s of acceptedShares) {
        if (s.resource_type === 'file') {
          const f = db
            .prepare(
              `SELECT * FROM files WHERE id = ? AND is_vault = 0 AND is_trashed = 0 ${q ? 'AND LOWER(name) LIKE ?' : ''}`
            )
            .get(...(q ? [s.resource_id, `%${q}%`] : [s.resource_id])) as any;
          if (f && !seenSharedFiles.has(f.id)) {
            if (typeFilter !== 'all' && typeFilter !== f.media_kind) continue;
            seenSharedFiles.add(f.id);
            results.push({
              resultType: 'file',
              location: 'Shared With Me',
              sharingStatus: `Shared (${s.permission})`,
              item: serializeFile(f, user.id, {
                permission: s.permission,
                ownerName: s.owner_name,
                ownerEmail: s.owner_email,
              }),
            });
          }
        } else if (s.resource_type === 'folder') {
          const fld = db
            .prepare('SELECT * FROM folders WHERE id = ? AND is_vault = 0 AND is_trashed = 0')
            .get(s.resource_id) as any;
          if (!fld) continue;
          if ((typeFilter === 'all' || typeFilter === 'folder') && (!q || fld.name.toLowerCase().includes(q))) {
            results.push({
              resultType: 'folder',
              location: 'Shared With Me',
              sharingStatus: `Shared (${s.permission})`,
              ownerName: s.owner_name,
              item: { id: fld.id, name: fld.name, createdAt: fld.created_at },
            });
          }
          const folderFiles = db
            .prepare(
              `SELECT * FROM files WHERE folder_id = ? AND is_vault = 0 AND is_trashed = 0 ${q ? 'AND LOWER(name) LIKE ?' : ''}`
            )
            .all(...(q ? [fld.id, `%${q}%`] : [fld.id])) as any[];
          for (const ff of folderFiles) {
            if (seenSharedFiles.has(ff.id)) continue;
            if (typeFilter !== 'all' && typeFilter !== ff.media_kind) continue;
            seenSharedFiles.add(ff.id);
            results.push({
              resultType: 'file',
              location: `Shared · ${fld.name}`,
              sharingStatus: `Shared (${s.permission})`,
              item: serializeFile(ff, user.id, {
                permission: s.permission,
                ownerName: s.owner_name,
                ownerEmail: s.owner_email,
              }),
            });
          }
        }
      }
    }

    res.json({ results: results.slice(0, 80) });
  });

  // --- NOTIFICATIONS & ACTIVITY ---
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
      .all(user.id) as any[];
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        resourceType: n.resource_type,
        resourceId: n.resource_id,
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
      })),
    });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    res.json({ ok: true });
  });

  app.get('/api/activity', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.user!.id) as any[];
    res.json({
      activity: rows.map((a) => ({
        id: a.id,
        action: a.action,
        targetName: a.target_name,
        targetType: a.target_type,
        details: a.details,
        createdAt: a.created_at,
      })),
    });
  });
}
