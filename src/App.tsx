import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  FolderOpen,
  FolderUp,
  Home as HomeIcon,
  Image as ImageIcon,
  Lock,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { BrandLogo } from './components/BrandLogo';
import {
  ActivityView,
  AlbumsView,
  FavoritesView,
  RecentView,
  SearchView,
  SettingsView,
  TrashView,
} from './components/CollectionViews';
import { DriveView } from './components/DriveView';
import { HomeDashboard } from './components/HomeDashboard';
import { PhotosView } from './components/PhotosView';
import { PublicShareView } from './components/PublicShareView';
import { SharingView } from './components/SharingView';
import { Sidebar } from './components/Sidebar';
import { StorageView } from './components/StorageView';
import { TopBar } from './components/TopBar';
import { UploadManagerDrawer } from './components/UploadManagerDrawer';
import { VaultView } from './components/VaultView';
import { AshcloudProvider, useAshcloud } from './context/AshcloudContext';
import type { NavSection } from './types';

function QuickUploadModal({ onClose }: { onClose: () => void }) {
  const { folders, enqueueUploads } = useAshcloud();
  const [destination, setDestination] = useState<'photos' | 'drive'>('photos');
  const [folderId, setFolderId] = useState<string>('');
  const [duplicateAction, setDuplicateAction] = useState<'keep_both' | 'skip' | 'replace'>('keep_both');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const selectedFolderName = folders.find((f) => f.id === folderId)?.name || 'My Drive';

  const dispatchFiles = (list: FileList | null, withRelative = false) => {
    if (!list || list.length === 0) return;
    enqueueUploads(
      Array.from(list).map((file) => ({
        file,
        relativePath: withRelative ? (file as any).webkitRelativePath || file.name : undefined,
      })),
      {
        folderId: destination === 'drive' && folderId ? folderId : null,
        destinationLabel: destination === 'photos' ? 'Photos' : selectedFolderName,
        isVault: false,
        duplicateAction,
      }
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Upload to ASHCLOUD</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-500 mb-1.5">Destination</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDestination('photos')}
                className={`py-2 px-3 rounded-xl border font-semibold ${
                  destination === 'photos'
                    ? 'border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB] dark:text-[#38BDF8]'
                    : 'border-slate-200 dark:border-[#232B3B]'
                }`}
              >
                Photos Timeline
              </button>
              <button
                type="button"
                onClick={() => setDestination('drive')}
                className={`py-2 px-3 rounded-xl border font-semibold ${
                  destination === 'drive'
                    ? 'border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB] dark:text-[#38BDF8]'
                    : 'border-slate-200 dark:border-[#232B3B]'
                }`}
              >
                Drive Folder
              </button>
            </div>
          </div>

          {destination === 'drive' && (
            <div>
              <label className="block font-medium text-slate-500 mb-1">Target Drive Folder</label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B]"
              >
                <option value="">My Drive (Root)</option>
                {folders.map((fld) => (
                  <option key={fld.id} value={fld.id}>
                    {fld.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-500 mb-1">If Duplicate File Exists</label>
            <select
              value={duplicateAction}
              onChange={(e) => setDuplicateAction(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B]"
            >
              <option value="keep_both">Keep both (auto-rename)</option>
              <option value="replace">Replace existing file</option>
              <option value="skip">Skip duplicate</option>
            </select>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => dispatchFiles(e.target.files, false)}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          {...({ webkitdirectory: '', directory: '' } as any)}
          className="hidden"
          onChange={(e) => dispatchFiles(e.target.files, true)}
        />

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold"
          >
            <Upload className="w-4 h-4" />
            Select Files
          </button>
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-[#232B3B] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#18202F]"
          >
            <FolderUp className="w-4 h-4 text-[#38BDF8]" />
            Select Folder
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileBottomNav({
  activeNav,
  onSelect,
}: {
  activeNav: NavSection;
  onSelect: (nav: NavSection) => void;
}) {
  const items: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'photos', label: 'Photos', icon: ImageIcon },
    { id: 'drive', label: 'Drive', icon: FolderOpen },
    { id: 'home', label: 'Home', icon: HomeIcon },
    { id: 'vault', label: 'Vault', icon: Lock },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-white/95 dark:bg-[#131823]/95 backdrop-blur border-t border-slate-200 dark:border-[#232B3B] grid grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeNav === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              active ? 'text-[#2563EB] dark:text-[#38BDF8]' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function AshcloudWorkspace() {
  const {
    user,
    authLoading,
    activeNav,
    setActiveNav,
    libraryLoading,
    libraryLoaded,
    rateLimitError,
    dismissRateLimitError,
    retryAfterRateLimit,
    toasts,
    dismissToast,
  } = useAshcloud();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickUploadOpen, setQuickUploadOpen] = useState(false);

  // Public share route (/s/:token)
  const path = window.location.pathname;
  if (path.startsWith('/s/')) {
    const token = path.slice('/s/'.length).split('/')[0];
    if (token) return <PublicShareView token={token} />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0B0E14] text-[#F8FAFC] flex flex-col items-center justify-center gap-4 p-6">
        <BrandLogo variant="full" />
        <p className="text-xs text-slate-400">One Cloud. Every File. Every Memory.</p>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B0E14] text-[#111827] dark:text-[#F8FAFC] flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 pb-14 lg:pb-0">
        <TopBar
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickUpload={() => setQuickUploadOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {rateLimitError && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">Temporary Rate Limit Reached</div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {rateLimitError.message} Wait ~{rateLimitError.retryAfterSeconds}s and try again.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={retryAfterRateLimit}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={dismissRateLimitError}
                    className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {libraryLoading && !libraryLoaded ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-pulse">
                <div className="aspect-square rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B]" />
                <div className="aspect-square rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B]" />
                <div className="aspect-square rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B]" />
                <div className="aspect-square rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B]" />
              </div>
            ) : (
              <>
                {activeNav === 'home' && <HomeDashboard />}
                {activeNav === 'photos' && <PhotosView onOpenAlbumsTab={() => setActiveNav('albums')} />}
                {activeNav === 'albums' && <AlbumsView />}
                {activeNav === 'drive' && <DriveView />}
                {activeNav === 'vault' && <VaultView />}
                {activeNav === 'favorites' && <FavoritesView />}
                {activeNav === 'recent' && <RecentView />}
                {activeNav === 'shared-with-me' && <SharingView mode="with-me" />}
                {activeNav === 'shared-by-me' && <SharingView mode="by-me" />}
                {activeNav === 'trash' && <TrashView />}
                {activeNav === 'storage' && <StorageView />}
                {activeNav === 'activity' && <ActivityView />}
                {activeNav === 'settings' && <SettingsView />}
                {activeNav === 'search' && <SearchView />}
              </>
            )}
          </div>
        </main>
      </div>

      <MobileBottomNav activeNav={activeNav} onSelect={setActiveNav} />

      {quickUploadOpen && <QuickUploadModal onClose={() => setQuickUploadOpen(false)} />}
      <UploadManagerDrawer />

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-20 right-4 z-50 space-y-2 w-80 max-w-[calc(100vw-2rem)]">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`p-3.5 rounded-xl bg-white dark:bg-[#131823] border shadow-lg flex items-start justify-between gap-3 ${
                t.kind === 'error'
                  ? 'border-red-500/40'
                  : t.kind === 'success'
                  ? 'border-emerald-500/40'
                  : 'border-slate-200 dark:border-[#232B3B]'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold">{t.title}</div>
                {t.description && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {t.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AshcloudProvider>
      <AshcloudWorkspace />
    </AshcloudProvider>
  );
}
