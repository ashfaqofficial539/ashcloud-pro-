import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  apiFetch,
  RateLimitError,
  setAuthToken,
  setVaultToken,
  uploadFileWithProgress,
} from '../lib/api';
import {
  disconnectGoogleOAuth,
  signInWithGoogleOAuth,
} from '../lib/googleAuth';
import type {
  ActivityItem,
  Album,
  CloudFile,
  CloudFolder,
  DemoAccount,
  NavSection,
  NotificationItem,
  SharedByMeItem,
  SharedWithMeItem,
  StorageSummary,
  UploadTask,
  User,
} from '../types';

export interface ToastMessage {
  id: string;
  kind: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

interface AshcloudContextValue {
  user: User | null;
  demoAccounts: DemoAccount[];
  authLoading: boolean;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  activeNav: NavSection;
  setActiveNav: (nav: NavSection) => void;
  photosInitialTab: 'my-photos' | 'shared-with-me' | 'albums';
  setPhotosInitialTab: (tab: 'my-photos' | 'shared-with-me' | 'albums') => void;
  driveInitialTab: 'my-drive' | 'shared-with-me' | 'shared-by-me';
  setDriveInitialTab: (tab: 'my-drive' | 'shared-with-me' | 'shared-by-me') => void;
  globalSearchQuery: string;
  setGlobalSearchQuery: (q: string) => void;

  // Library cache
  libraryLoaded: boolean;
  libraryLoading: boolean;
  files: CloudFile[];
  folders: CloudFolder[];
  trashedFiles: CloudFile[];
  trashedFolders: CloudFolder[];
  albums: Album[];
  sharesWithMe: SharedWithMeItem[];
  sharesByMe: SharedByMeItem[];
  storageSummary: StorageSummary | null;
  notifications: NotificationItem[];
  activity: ActivityItem[];

  // Rate limit recovery
  rateLimitError: { message: string; retryAfterSeconds: number } | null;
  dismissRateLimitError: () => void;
  retryAfterRateLimit: () => void;

  // Auth actions
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  demoLogin: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;

  // Data refresh
  refreshAll: (force?: boolean) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshShares: () => Promise<void>;
  refreshStorage: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  ensureFreshUrls: (fileIds: string[]) => Promise<void>;

  // Upload queue
  uploadTasks: UploadTask[];
  uploadDrawerOpen: boolean;
  setUploadDrawerOpen: (open: boolean) => void;
  enqueueUploads: (
    files: Array<{ file: File; relativePath?: string }>,
    options: {
      folderId?: string | null;
      destinationLabel: string;
      isVault?: boolean;
      duplicateAction?: 'keep_both' | 'skip' | 'replace';
    }
  ) => void;
  retryUpload: (taskId: string) => void;
  cancelUpload: (taskId: string) => void;
  clearFinishedUploads: () => void;

  // Vault
  vaultUnlocked: boolean;
  vaultExpiresAt: number | null;
  vaultFiles: CloudFile[];
  vaultFolders: CloudFolder[];
  setupVaultPin: (pin: string) => Promise<void>;
  unlockVault: (pin: string) => Promise<void>;
  lockVault: () => void;
  refreshVaultItems: () => Promise<void>;

  // Clipboard for Drive
  clipboard: { mode: 'copy' | 'cut'; fileIds: string[] } | null;
  setClipboard: (clip: { mode: 'copy' | 'cut'; fileIds: string[] } | null) => void;

  // Toasts
  toasts: ToastMessage[];
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const AshcloudContext = createContext<AshcloudContextValue | null>(null);

export function AshcloudProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [authLoading, setAuthLoading] = useState(true);

  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('ashcloud_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  const [activeNav, setActiveNav] = useState<NavSection>('photos');
  const [photosInitialTab, setPhotosInitialTab] = useState<'my-photos' | 'shared-with-me' | 'albums'>('my-photos');
  const [driveInitialTab, setDriveInitialTab] = useState<'my-drive' | 'shared-with-me' | 'shared-by-me'>('my-drive');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');

  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [trashedFiles, setTrashedFiles] = useState<CloudFile[]>([]);
  const [trashedFolders, setTrashedFolders] = useState<CloudFolder[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [sharesWithMe, setSharesWithMe] = useState<SharedWithMeItem[]>([]);
  const [sharesByMe, setSharesByMe] = useState<SharedByMeItem[]>([]);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const [rateLimitError, setRateLimitError] = useState<{ message: string; retryAfterSeconds: number } | null>(null);

  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const activeUploadCountRef = useRef(0);
  const uploadQueueRef = useRef<UploadTask[]>([]);

  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultExpiresAt, setVaultExpiresAt] = useState<number | null>(null);
  const [vaultFiles, setVaultFiles] = useState<CloudFile[]>([]);
  const [vaultFolders, setVaultFolders] = useState<CloudFolder[]>([]);

  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; fileIds: string[] } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const inflightSignRef = useRef(false);

  // Sync theme with <html class="dark">
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('ashcloud_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `tst_${Math.random().toString(36).slice(2, 10)}`;
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const setTheme = useCallback(
    (next: 'dark' | 'light') => {
      setThemeState(next);
      if (user) {
        apiFetch('/api/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify({ themePref: next }),
        }).catch(() => {});
      }
    },
    [user]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const handlePossibleRateLimit = useCallback((err: unknown) => {
    if (err instanceof RateLimitError) {
      setRateLimitError({
        message: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      });
      return true;
    }
    return false;
  }, []);

  const clearAccountCache = useCallback(() => {
    setLibraryLoaded(false);
    setFiles([]);
    setFolders([]);
    setTrashedFiles([]);
    setTrashedFolders([]);
    setAlbums([]);
    setSharesWithMe([]);
    setSharesByMe([]);
    setStorageSummary(null);
    setNotifications([]);
    setActivity([]);
    setVaultToken(null);
    setVaultUnlocked(false);
    setVaultExpiresAt(null);
    setVaultFiles([]);
    setVaultFolders([]);
    setClipboard(null);
    setUploadTasks([]);
    setRateLimitError(null);
  }, []);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const data = await apiFetch<{
        files: CloudFile[];
        folders: CloudFolder[];
        trashedFiles: CloudFile[];
        trashedFolders: CloudFolder[];
        albums: Album[];
      }>('/api/library?includeTrashed=0');
      setFiles(data.files);
      setFolders(data.folders);
      setTrashedFiles(data.trashedFiles);
      setTrashedFolders(data.trashedFolders);
      setAlbums(data.albums);
      setLibraryLoaded(true);
    } catch (err) {
      if (!handlePossibleRateLimit(err)) throw err;
    } finally {
      setLibraryLoading(false);
    }
  }, [handlePossibleRateLimit]);

  const refreshShares = useCallback(async () => {
    try {
      const [withMe, byMe] = await Promise.all([
        apiFetch<{ shares: SharedWithMeItem[] }>('/api/shares/with-me'),
        apiFetch<{ shares: SharedByMeItem[] }>('/api/shares/by-me'),
      ]);
      setSharesWithMe(withMe.shares);
      setSharesByMe(byMe.shares);
    } catch (err) {
      handlePossibleRateLimit(err);
    }
  }, [handlePossibleRateLimit]);

  const refreshStorage = useCallback(async () => {
    try {
      const summary = await apiFetch<StorageSummary>('/api/storage/summary');
      setStorageSummary(summary);
    } catch (err) {
      handlePossibleRateLimit(err);
    }
  }, [handlePossibleRateLimit]);

  const refreshNotifications = useCallback(async () => {
    try {
      const [ntf, act] = await Promise.all([
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
        apiFetch<{ activity: ActivityItem[] }>('/api/activity'),
      ]);
      setNotifications(ntf.notifications);
      setActivity(act.activity);
    } catch (err) {
      handlePossibleRateLimit(err);
    }
  }, [handlePossibleRateLimit]);

  const refreshAll = useCallback(
    async (force = false) => {
      if (!force && libraryLoaded) return;
      await Promise.all([refreshLibrary(), refreshShares(), refreshStorage(), refreshNotifications()]);
    },
    [libraryLoaded, refreshLibrary, refreshShares, refreshStorage, refreshNotifications]
  );

  const ensureFreshUrls = useCallback(
    async (fileIds: string[]) => {
      if (inflightSignRef.current || fileIds.length === 0) return;
      const now = Date.now();
      const staleIds = files
        .filter((f) => fileIds.includes(f.id) && f.urlExpiresAt - now < 60_000)
        .map((f) => f.id);
      if (staleIds.length === 0) return;

      inflightSignRef.current = true;
      try {
        const res = await apiFetch<{ urls: Record<string, { url: string; downloadUrl: string; expiresAt: number }> }>(
          '/api/files/sign-batch',
          {
            method: 'POST',
            body: JSON.stringify({ fileIds: staleIds.slice(0, 50) }),
          }
        );
        setFiles((prev) =>
          prev.map((f) =>
            res.urls[f.id]
              ? {
                  ...f,
                  url: res.urls[f.id].url,
                  downloadUrl: res.urls[f.id].downloadUrl,
                  urlExpiresAt: res.urls[f.id].expiresAt,
                }
              : f
          )
        );
      } catch (err) {
        handlePossibleRateLimit(err);
      } finally {
        inflightSignRef.current = false;
      }
    },
    [files, handlePossibleRateLimit]
  );

  // Initial load of demo workspace directory (for quick sign-in screen)
  useEffect(() => {
    let active = true;
    apiFetch<{ accounts: DemoAccount[] }>('/api/auth/demo-accounts')
      .then((res) => {
        if (active) setDemoAccounts(res.accounts || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const afterSignIn = useCallback(
    async (nextUser: User, token: string) => {
      clearAccountCache();
      setAuthToken(token);
      setUser(nextUser);
      setActiveNav('photos');
      setThemeState(nextUser.themePref === 'light' ? 'light' : 'dark');
      await Promise.all([refreshLibrary(), refreshShares(), refreshStorage(), refreshNotifications()]);
    },
    [clearAccountCache, refreshLibrary, refreshShares, refreshStorage, refreshNotifications]
  );

  const loginWithGoogle = useCallback(async () => {
    const gAuth = await signInWithGoogleOAuth();
    const res = await apiFetch<{ token: string; user: User }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken: gAuth.idToken }),
    });
    await afterSignIn(res.user, res.token);
  }, [afterSignIn]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await afterSignIn(res.user, res.token);
    },
    [afterSignIn]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      await afterSignIn(res.user, res.token);
    },
    [afterSignIn]
  );

  const demoLogin = useCallback(
    async (email: string) => {
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      await afterSignIn(res.user, res.token);
    },
    [afterSignIn]
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    await disconnectGoogleOAuth();
    setAuthToken(null);
    setUser(null);
    clearAccountCache();
  }, [clearAccountCache]);

  const refreshProfile = useCallback(async () => {
    const res = await apiFetch<{ user: User }>('/api/auth/me');
    setUser(res.user);
  }, []);

  // --- VAULT ---
  const lockVault = useCallback(() => {
    setVaultToken(null);
    setVaultUnlocked(false);
    setVaultExpiresAt(null);
    setVaultFiles([]);
    setVaultFolders([]);
  }, []);

  const refreshVaultItems = useCallback(async () => {
    const res = await apiFetch<{ files: CloudFile[]; folders: CloudFolder[] }>('/api/vault/items');
    setVaultFiles(res.files);
    setVaultFolders(res.folders);
  }, []);

  const setupVaultPin = useCallback(
    async (pin: string) => {
      const res = await apiFetch<{ vaultToken: string; expiresAt: number }>('/api/vault/setup', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      });
      setVaultToken(res.vaultToken);
      setVaultUnlocked(true);
      setVaultExpiresAt(res.expiresAt);
      await Promise.all([refreshProfile(), refreshVaultItems()]);
    },
    [refreshProfile, refreshVaultItems]
  );

  const unlockVault = useCallback(
    async (pin: string) => {
      const res = await apiFetch<{ vaultToken: string; expiresAt: number }>('/api/vault/unlock', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      });
      setVaultToken(res.vaultToken);
      setVaultUnlocked(true);
      setVaultExpiresAt(res.expiresAt);
      await refreshVaultItems();
    },
    [refreshVaultItems]
  );

  // Auto-lock Vault when expiry hits
  useEffect(() => {
    if (!vaultUnlocked || !vaultExpiresAt) return;
    const ms = Math.max(0, vaultExpiresAt - Date.now());
    const timer = setTimeout(() => {
      lockVault();
      pushToast({ kind: 'info', title: 'Hidden Vault locked', description: 'Session timer expired.' });
    }, ms);
    return () => clearTimeout(timer);
  }, [vaultUnlocked, vaultExpiresAt, lockVault, pushToast]);

  // --- UPLOAD QUEUE ---
  useEffect(() => {
    uploadQueueRef.current = uploadTasks;
  }, [uploadTasks]);

  const processUploadQueue = useCallback(() => {
    const maxConcurrent = 3;
    setUploadTasks((current) => {
      const uploadingCount = current.filter((t) => t.status === 'uploading').length;
      activeUploadCountRef.current = uploadingCount;
      if (uploadingCount >= maxConcurrent) return current;

      const availableSlots = maxConcurrent - uploadingCount;
      const pending = current.filter((t) => t.status === 'pending').slice(0, availableSlots);
      if (pending.length === 0) return current;

      for (const task of pending) {
        uploadFileWithProgress({
          file: task.file,
          folderId: task.folderId,
          relativePath: task.relativePath,
          isVault: task.isVault,
          duplicateAction: task.duplicateAction,
          onProgress: (pct) => {
            setUploadTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, progress: pct } : item)));
          },
          onAbortReady: (abortFn) => {
            setUploadTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, abortFn } : item)));
          },
        })
          .then(async (res) => {
            setUploadTasks((prev) =>
              prev.map((item) =>
                item.id === task.id
                  ? { ...item, status: 'completed', progress: 100, abortFn: undefined }
                  : item
              )
            );
            if (!res.skipped) {
              await Promise.all([
                task.isVault ? refreshVaultItems() : refreshLibrary(),
                refreshStorage(),
                refreshNotifications(),
              ]);
            }
          })
          .catch((err) => {
            const isCancelled = err?.code === 'CANCELLED';
            setUploadTasks((prev) =>
              prev.map((item) =>
                item.id === task.id
                  ? {
                      ...item,
                      status: isCancelled ? 'cancelled' : 'failed',
                      error: isCancelled ? 'Cancelled' : err?.message || 'Upload failed',
                      abortFn: undefined,
                    }
                  : item
              )
            );
            handlePossibleRateLimit(err);
          })
          .finally(() => {
            setTimeout(() => processUploadQueue(), 40);
          });
      }

      const pendingIds = new Set(pending.map((p) => p.id));
      return current.map((item) => (pendingIds.has(item.id) ? { ...item, status: 'uploading' } : item));
    });
  }, [handlePossibleRateLimit, refreshLibrary, refreshNotifications, refreshStorage, refreshVaultItems]);

  const enqueueUploads = useCallback(
    (
      incoming: Array<{ file: File; relativePath?: string }>,
      options: {
        folderId?: string | null;
        destinationLabel: string;
        isVault?: boolean;
        duplicateAction?: 'keep_both' | 'skip' | 'replace';
      }
    ) => {
      if (incoming.length === 0) return;
      const newTasks: UploadTask[] = incoming.map(({ file, relativePath }) => ({
        id: `upl_${crypto.randomUUID().slice(0, 10)}`,
        file,
        name: file.name,
        sizeBytes: file.size,
        progress: 0,
        status: 'pending',
        destinationLabel: options.destinationLabel,
        folderId: options.folderId ?? null,
        relativePath,
        isVault: Boolean(options.isVault),
        duplicateAction: options.duplicateAction ?? 'keep_both',
      }));
      setUploadTasks((prev) => [...prev, ...newTasks]);
      setUploadDrawerOpen(true);
      setTimeout(() => processUploadQueue(), 20);
    },
    [processUploadQueue]
  );

  const retryUpload = useCallback(
    (taskId: string) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'pending', progress: 0, error: undefined } : t))
      );
      setTimeout(() => processUploadQueue(), 20);
    },
    [processUploadQueue]
  );

  const cancelUpload = useCallback((taskId: string) => {
    setUploadTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        if (t.abortFn) t.abortFn();
        return { ...t, status: 'cancelled', error: 'Cancelled', abortFn: undefined };
      })
    );
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setUploadTasks((prev) => prev.filter((t) => t.status === 'pending' || t.status === 'uploading'));
  }, []);

  const dismissRateLimitError = useCallback(() => setRateLimitError(null), []);
  const retryAfterRateLimit = useCallback(() => {
    setRateLimitError(null);
    refreshAll(true).catch(() => {});
  }, [refreshAll]);

  return (
    <AshcloudContext.Provider
      value={{
        user,
        demoAccounts,
        authLoading,
        theme,
        toggleTheme,
        setTheme,
        activeNav,
        setActiveNav,
        photosInitialTab,
        setPhotosInitialTab,
        driveInitialTab,
        setDriveInitialTab,
        globalSearchQuery,
        setGlobalSearchQuery,
        libraryLoaded,
        libraryLoading,
        files,
        folders,
        trashedFiles,
        trashedFolders,
        albums,
        sharesWithMe,
        sharesByMe,
        storageSummary,
        notifications,
        activity,
        rateLimitError,
        dismissRateLimitError,
        retryAfterRateLimit,
        login,
        register,
        loginWithGoogle,
        demoLogin,
        logout,
        refreshProfile,
        refreshAll,
        refreshLibrary,
        refreshShares,
        refreshStorage,
        refreshNotifications,
        ensureFreshUrls,
        uploadTasks,
        uploadDrawerOpen,
        setUploadDrawerOpen,
        enqueueUploads,
        retryUpload,
        cancelUpload,
        clearFinishedUploads,
        vaultUnlocked,
        vaultExpiresAt,
        vaultFiles,
        vaultFolders,
        setupVaultPin,
        unlockVault,
        lockVault,
        refreshVaultItems,
        clipboard,
        setClipboard,
        toasts,
        pushToast,
        dismissToast,
      }}
    >
      {children}
    </AshcloudContext.Provider>
  );
}

export function useAshcloud() {
  const ctx = useContext(AshcloudContext);
  if (!ctx) throw new Error('useAshcloud must be used within AshcloudProvider');
  return ctx;
}
