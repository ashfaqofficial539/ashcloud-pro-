import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashSecret } from './security.ts';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
export const STORAGE_OBJECTS_DIR = path.resolve(STORAGE_ROOT, 'objects');
export const STORAGE_TEMP_DIR = path.resolve(STORAGE_ROOT, 'tmp');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_OBJECTS_DIR, { recursive: true });
fs.mkdirSync(STORAGE_TEMP_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'ashcloud.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    is_demo INTEGER NOT NULL DEFAULT 0,
    vault_pin_hash TEXT,
    vault_auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
    theme_pref TEXT NOT NULL DEFAULT 'dark',
    language_pref TEXT NOT NULL DEFAULT 'en',
    upload_quality TEXT NOT NULL DEFAULT 'original',
    notify_shares INTEGER NOT NULL DEFAULT 1,
    notify_uploads INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_info TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_vault INTEGER NOT NULL DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_trashed INTEGER NOT NULL DEFAULT 0,
    trashed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    media_kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    sha256_hash TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_sec REAL,
    taken_at TEXT,
    is_vault INTEGER NOT NULL DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_trashed INTEGER NOT NULL DEFAULT 0,
    trashed_at TEXT,
    last_opened_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS album_items (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (album_id, file_id)
  );

  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    recipient_email TEXT,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('file', 'folder', 'album')),
    resource_id TEXT NOT NULL,
    permission TEXT NOT NULL CHECK(permission IN ('viewer', 'commenter', 'editor')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected', 'revoked')),
    share_token TEXT UNIQUE NOT NULL,
    is_link_public INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_name TEXT NOT NULL,
    target_type TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_shared_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_files_owner_vault_trash ON files(owner_id, is_vault, is_trashed);
  CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
  CREATE INDEX IF NOT EXISTS idx_folders_owner_parent ON folders(owner_id, parent_id);
  CREATE INDEX IF NOT EXISTS idx_shares_recipient ON shares(recipient_id, recipient_email, status);
  CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id, status);
  CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(share_token);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_saved_shared_user ON saved_shared_items(user_id);
`);

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('files', 'source_provider', `TEXT NOT NULL DEFAULT 'upload'`);
ensureColumn('files', 'external_id', 'TEXT');
ensureColumn('files', 'copied_from_share_id', 'TEXT');
ensureColumn('files', 'copied_from_owner_name', 'TEXT');
ensureColumn('shares', 'allow_copy', 'INTEGER NOT NULL DEFAULT 1');
db.exec(`CREATE INDEX IF NOT EXISTS idx_files_external ON files(owner_id, source_provider, external_id);`);

function copySeedAssetToStorage(assetFileName: string): { storageKey: string; sizeBytes: number; sha256: string } | null {
  const srcPath = path.resolve(process.cwd(), 'src', 'assets', 'images', assetFileName);
  if (!fs.existsSync(srcPath)) return null;
  const buf = fs.readFileSync(srcPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const storageKey = `${sha256.slice(0, 24)}-${crypto.randomUUID()}.jpg`;
  const destPath = path.join(STORAGE_OBJECTS_DIR, storageKey);
  fs.writeFileSync(destPath, buf);
  return { storageKey, sizeBytes: buf.length, sha256 };
}

function writeSeedTextToStorage(content: string, ext: string): { storageKey: string; sizeBytes: number; sha256: string } {
  const buf = Buffer.from(content, 'utf8');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const storageKey = `${sha256.slice(0, 24)}-${crypto.randomUUID()}.${ext}`;
  const destPath = path.join(STORAGE_OBJECTS_DIR, storageKey);
  fs.writeFileSync(destPath, buf);
  return { storageKey, sizeBytes: buf.length, sha256 };
}

export function seedInitialWorkspaceIfEmpty(): void {
  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
  if (userCount.cnt > 0) return;

  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400 * 1000).toISOString();

  const ashfaqId = 'usr_ashfaq_01';
  const mayaId = 'usr_maya_02';

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, name, password_hash, avatar_url, role, is_demo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);

  insertUser.run(
    ashfaqId,
    'ashfaq@ashcloud.io',
    'Ashfaq Rahman',
    hashSecret(crypto.randomBytes(24).toString('hex')),
    '/src/assets/images/avatar_ashfaq_profile_1795753629675.jpg',
    'owner',
    daysAgo(30)
  );

  insertUser.run(
    mayaId,
    'maya@ashcloud.io',
    'Maya Lin',
    hashSecret(crypto.randomBytes(24).toString('hex')),
    null,
    'member',
    daysAgo(21)
  );

  // Create Drive folders for Ashfaq
  const projectsFolderId = 'fld_projects_01';
  const specsFolderId = 'fld_specs_02';
  const travelDocsFolderId = 'fld_travel_03';

  const insertFolder = db.prepare(`
    INSERT INTO folders (id, owner_id, parent_id, name, is_vault, is_favorite, is_trashed, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)
  `);

  insertFolder.run(projectsFolderId, ashfaqId, null, 'ASHCLOUD Architecture', 1, daysAgo(14), hoursAgo(5));
  insertFolder.run(specsFolderId, ashfaqId, projectsFolderId, 'Storage Specs', 0, daysAgo(10), hoursAgo(12));
  insertFolder.run(travelDocsFolderId, ashfaqId, null, 'Travel & Memories', 0, daysAgo(7), daysAgo(2));

  const insertFile = db.prepare(`
    INSERT INTO files (
      id, owner_id, folder_id, name, original_name, mime_type, media_kind, size_bytes,
      storage_key, sha256_hash, width, height, taken_at, is_vault, is_favorite, is_trashed,
      last_opened_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);

  const samplePhotos = [
    {
      id: 'fil_amalfi_01',
      asset: 'sample_amalfi_coast_1795753628744.jpg',
      name: 'Amalfi-Golden-Hour.jpg',
      width: 1920,
      height: 1080,
      takenAt: hoursAgo(3),
      createdAt: hoursAgo(3),
      favorite: 1,
    },
    {
      id: 'fil_kyoto_02',
      asset: 'sample_kyoto_garden_1795753629305.jpg',
      name: 'Kyoto-Maple-Pathway.jpg',
      width: 1600,
      height: 1200,
      takenAt: daysAgo(1),
      createdAt: daysAgo(1),
      favorite: 1,
    },
    {
      id: 'fil_dinner_03',
      asset: 'sample_artisan_dinner_1795753630376.jpg',
      name: 'Autumn-Table-Gathering.jpg',
      width: 1600,
      height: 1200,
      takenAt: daysAgo(3),
      createdAt: daysAgo(3),
      favorite: 0,
    },
    {
      id: 'fil_cairo_04',
      asset: 'sample_cairo_temple_1795753628917.jpg',
      name: 'Karnak-Sandstone-Columns.jpg',
      width: 1200,
      height: 1600,
      takenAt: daysAgo(18),
      createdAt: daysAgo(18),
      favorite: 1,
    },
  ];

  for (const photo of samplePhotos) {
    const stored = copySeedAssetToStorage(photo.asset);
    if (stored) {
      insertFile.run(
        photo.id,
        ashfaqId,
        null,
        photo.name,
        photo.name,
        'image/jpeg',
        'photo',
        stored.sizeBytes,
        stored.storageKey,
        stored.sha256,
        photo.width,
        photo.height,
        photo.takenAt,
        0,
        photo.favorite,
        hoursAgo(2),
        photo.createdAt,
        photo.createdAt
      );
    }
  }

  // Seed Drive Documents
  const archNote = writeSeedTextToStorage(
    `# ASHCLOUD — 512 TB Target Storage Architecture\n\n` +
      `## Core Principles\n` +
      `1. Deduplicated object storage keys (SHA-256 content addressing + unique object keys)\n` +
      `2. Zero duplication on shared links or accepted invitations\n` +
      `3. Short-lived HMAC-SHA256 signed content URLs with concurrency batching\n` +
      `4. Strict server-side Hidden Vault PIN isolation\n` +
      `5. Honest capacity reporting: real measured bytes vs provisioned node disk vs 512 TB target tier.\n`,
    'md'
  );

  insertFile.run(
    'fil_doc_arch_01',
    ashfaqId,
    projectsFolderId,
    'ASHCLOUD-512TB-Architecture.md',
    'ASHCLOUD-512TB-Architecture.md',
    'text/markdown',
    'document',
    archNote.sizeBytes,
    archNote.storageKey,
    archNote.sha256,
    null,
    null,
    null,
    0,
    1,
    hoursAgo(1),
    daysAgo(4),
    hoursAgo(6)
  );

  const storageSpecCsv = writeSeedTextToStorage(
    `Tier,Target Capacity,Replication,Encryption,Signed URL TTL\n` +
      `Hot Media Pool,128 TB,3x Cross-Zone,AES-256-GCM,900s\n` +
      `Drive Document Pool,256 TB,3x Erasure Coded,AES-256-GCM,900s\n` +
      `Hidden Vault Pool,128 TB,Zero-Knowledge PIN Isolated,AES-256-GCM,300s\n`,
    'csv'
  );

  insertFile.run(
    'fil_doc_csv_02',
    ashfaqId,
    specsFolderId,
    'Storage-Capacity-Allocation.csv',
    'Storage-Capacity-Allocation.csv',
    'text/csv',
    'document',
    storageSpecCsv.sizeBytes,
    storageSpecCsv.storageKey,
    storageSpecCsv.sha256,
    null,
    null,
    null,
    0,
    0,
    daysAgo(1),
    daysAgo(6),
    daysAgo(2)
  );

  const itineraryNote = writeSeedTextToStorage(
    `Mediterranean & Kyoto 2026 Field Notes\n` +
      `- Amalfi Coast: Ravello cliffs at 17:40 golden hour\n` +
      `- Kyoto Botanical Path: Early morning maple foliage\n` +
      `- Luxor & Karnak: Afternoon colonnade light study\n`,
    'txt'
  );

  insertFile.run(
    'fil_doc_trip_03',
    ashfaqId,
    travelDocsFolderId,
    'Expedition-Field-Notes.txt',
    'Expedition-Field-Notes.txt',
    'text/plain',
    'document',
    itineraryNote.sizeBytes,
    itineraryNote.storageKey,
    itineraryNote.sha256,
    null,
    null,
    null,
    0,
    0,
    daysAgo(2),
    daysAgo(5),
    daysAgo(5)
  );

  // Seed a file owned by Maya and shared with Ashfaq so Shared With Me works out of the box!
  const mayaSharedAsset = copySeedAssetToStorage('sample_kyoto_garden_1795753629305.jpg');
  if (mayaSharedAsset) {
    insertFile.run(
      'fil_maya_shared_01',
      mayaId,
      null,
      'Maya-Autumn-Botanical-Reference.jpg',
      'Maya-Autumn-Botanical-Reference.jpg',
      'image/jpeg',
      'photo',
      mayaSharedAsset.sizeBytes,
      mayaSharedAsset.storageKey,
      mayaSharedAsset.sha256,
      1600,
      1200,
      daysAgo(2),
      0,
      0,
      null,
      daysAgo(2),
      daysAgo(2)
    );

    db.prepare(`
      INSERT INTO shares (
        id, owner_id, recipient_id, recipient_email, resource_type, resource_id,
        permission, status, share_token, is_link_public, expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'file', ?, 'commenter', 'accepted', ?, 0, NULL, ?)
    `).run(
      'shr_maya_to_ashfaq_01',
      mayaId,
      ashfaqId,
      'ashfaq@ashcloud.io',
      'fil_maya_shared_01',
      crypto.randomBytes(18).toString('base64url'),
      daysAgo(1)
    );
  }

  const mayaDoc = writeSeedTextToStorage(
    `ASHCLOUD Design Review Checklist\n- Dark Mode Deep Navy (#111827) & Slate (#1F2937)\n- Electric Blue (#2563EB) primary actions\n- Tabular storage telemetry\n`,
    'txt'
  );
  insertFile.run(
    'fil_maya_doc_02',
    mayaId,
    null,
    'Design-Review-Checklist.txt',
    'Design-Review-Checklist.txt',
    'text/plain',
    'document',
    mayaDoc.sizeBytes,
    mayaDoc.storageKey,
    mayaDoc.sha256,
    null,
    null,
    null,
    0,
    0,
    null,
    hoursAgo(8),
    hoursAgo(8)
  );

  db.prepare(`
    INSERT INTO shares (
      id, owner_id, recipient_id, recipient_email, resource_type, resource_id,
      permission, status, share_token, is_link_public, expires_at, created_at
    ) VALUES (?, ?, ?, ?, 'file', ?, 'editor', 'pending', ?, 0, NULL, ?)
  `).run(
    'shr_maya_pending_02',
    mayaId,
    ashfaqId,
    'ashfaq@ashcloud.io',
    'fil_maya_doc_02',
    crypto.randomBytes(18).toString('base64url'),
    hoursAgo(6)
  );

  // Seed an Album for Ashfaq
  db.prepare(`
    INSERT INTO albums (id, owner_id, title, description, cover_file_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'alb_journeys_01',
    ashfaqId,
    'Journeys 2026',
    'Curated architectural and coastal photography across the Mediterranean, Kyoto, and Egypt.',
    'fil_amalfi_01',
    daysAgo(10),
    hoursAgo(3)
  );

  const insertAlbumItem = db.prepare(`
    INSERT INTO album_items (album_id, file_id, added_at) VALUES (?, ?, ?)
  `);
  insertAlbumItem.run('alb_journeys_01', 'fil_amalfi_01', hoursAgo(3));
  insertAlbumItem.run('alb_journeys_01', 'fil_kyoto_02', daysAgo(1));
  insertAlbumItem.run('alb_journeys_01', 'fil_cairo_04', daysAgo(10));

  // Notifications & Activity
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, resource_type, resource_id, is_read, created_at)
    VALUES (?, ?, 'share_invite', ?, ?, 'file', 'fil_maya_doc_02', 0, ?)
  `).run(
    'ntf_01',
    ashfaqId,
    'New sharing invitation',
    'Maya Lin invited you to collaborate as Editor on Design-Review-Checklist.txt.',
    hoursAgo(6)
  );

  const insertActivity = db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, target_name, target_type, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertActivity.run('act_01', ashfaqId, 'uploaded', 'Amalfi-Golden-Hour.jpg', 'photo', 'Added to Photos timeline', hoursAgo(3));
  insertActivity.run('act_02', ashfaqId, 'created_album', 'Journeys 2026', 'album', '3 photos organized', daysAgo(1));
  insertActivity.run('act_03', ashfaqId, 'uploaded', 'ASHCLOUD-512TB-Architecture.md', 'document', 'Saved in ASHCLOUD Architecture', daysAgo(4));
}
