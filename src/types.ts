export type NavSection =
  | 'home'
  | 'photos'
  | 'albums'
  | 'drive'
  | 'vault'
  | 'favorites'
  | 'recent'
  | 'shared-with-me'
  | 'shared-by-me'
  | 'trash'
  | 'storage'
  | 'activity'
  | 'settings'
  | 'search';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  isDemo: boolean;
  hasVaultPin: boolean;
  vaultAutoLockMinutes: number;
  themePref: 'dark' | 'light';
  languagePref: string;
  uploadQuality: 'original' | 'high';
  notifyShares: boolean;
  notifyUploads: boolean;
  createdAt: string;
}

export interface DemoAccount {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
}

export type MediaKind = 'photo' | 'video' | 'document' | 'audio' | 'archive' | 'other';

export interface CloudFile {
  id: string;
  ownerId: string;
  ownerName?: string;
  ownerEmail?: string;
  folderId: string | null;
  name: string;
  originalName: string;
  mimeType: string;
  mediaKind: MediaKind;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  takenAt?: string | null;
  isVault: boolean;
  isFavorite: boolean;
  isTrashed: boolean;
  trashedAt?: string | null;
  lastOpenedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  downloadUrl: string;
  urlExpiresAt: number;
  permission?: 'viewer' | 'commenter' | 'editor';
  sourceProvider?: 'upload' | 'google_photos' | 'google_drive' | 'shared_copy';
  savedMode?: 'reference' | 'copy' | null;
  savedShareId?: string | null;
  copiedFromOwnerName?: string | null;
  allowCopy?: boolean;
}

export interface CloudFolder {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  isVault: boolean;
  isFavorite: boolean;
  isTrashed: boolean;
  trashedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Album {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  coverFileId: string | null;
  coverUrl: string | null;
  fileIds: string[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedWithMeItem {
  shareId: string;
  status: 'pending' | 'accepted';
  permission: 'viewer' | 'commenter' | 'editor';
  allowCopy?: boolean;
  resourceType: 'file' | 'folder' | 'album';
  resourceId: string;
  ownerName: string;
  ownerEmail: string;
  sharedAt: string;
  expiresAt: string | null;
  file?: CloudFile;
  folder?: {
    id: string;
    name: string;
    createdAt: string;
    files: CloudFile[];
  };
  album?: {
    id: string;
    title: string;
    description: string;
    files: CloudFile[];
  };
}

export interface SharedByMeItem {
  id: string;
  resourceType: 'file' | 'folder' | 'album';
  resourceId: string;
  resourceName: string;
  mediaKind: MediaKind | null;
  recipientEmail: string | null;
  recipientName: string | null;
  permission: 'viewer' | 'commenter' | 'editor';
  status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';
  shareToken: string;
  isLinkPublic: boolean;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface StorageSummary {
  unitSystem: string;
  targetCapacityTb: number;
  targetCapacityBytes: number;
  provisionedCapacityBytes: number;
  provisionedAvailableBytes: number;
  platformUsedBytes: number;
  userUsedBytes: number;
  breakdown: {
    photosBytes: number;
    videosBytes: number;
    driveBytes: number;
    vaultBytes: number;
    trashedBytes: number;
  };
  counts: {
    photos: number;
    videos: number;
    files: number;
    folders: number;
    vaultItems: number;
    trashedItems: number;
  };
  largeFiles: Array<{
    id: string;
    name: string;
    mediaKind: MediaKind;
    sizeBytes: number;
    createdAt: string;
  }>;
  uploadHistory: Array<{
    date: string;
    label: string;
    bytes: number;
  }>;
  architecture: {
    provider: string;
    targetProvisionedOnCurrentNode: boolean;
    deduplicatedSharing: boolean;
  };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  targetName: string;
  targetType: string;
  details: string;
  createdAt: string;
}

export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';

export interface UploadTask {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  progress: number;
  status: UploadStatus;
  destinationLabel: string;
  folderId: string | null;
  relativePath?: string;
  isVault: boolean;
  duplicateAction: 'keep_both' | 'skip' | 'replace';
  error?: string;
  abortFn?: () => void;
}

export interface SearchResultItem {
  resultType: 'file' | 'folder' | 'album';
  location: string;
  sharingStatus: string;
  ownerName?: string;
  item: any;
}
