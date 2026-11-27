import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Calendar,
  Check,
  Download,
  Film,
  FolderPlus,
  Grid,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Lock,
  Plus,
  Search,
  Share2,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch, getAuthToken } from '../lib/api';
import { formatBytes, formatShortDate, getTimelineGroupLabel } from '../lib/format';
import type { CloudFile } from '../types';
import { MediaViewerModal } from './MediaViewerModal';
import { SaveToMyPhotosModal } from './SaveToMyPhotosModal';
import { ShareModal } from './ShareModal';

interface PhotosViewProps {
  onOpenAlbumsTab?: () => void;
}

interface SharedMediaEntry {
  file: CloudFile;
  shareId: string;
  ownerName: string;
  sharedAt: string;
  permission: 'viewer' | 'commenter' | 'editor';
  allowCopy: boolean;
}

export function PhotosView({ onOpenAlbumsTab }: PhotosViewProps) {
  const {
    files,
    albums,
    sharesWithMe,
    photosInitialTab,
    setPhotosInitialTab,
    enqueueUploads,
    refreshLibrary,
    refreshStorage,
    refreshVaultItems,
    vaultUnlocked,
    setActiveNav,
    pushToast,
  } = useAshcloud();

  const [tab, setTab] = useState<'my-photos' | 'shared-with-me' | 'albums'>(photosInitialTab);
  const [layout, setLayout] = useState<'comfortable' | 'compact' | 'mosaic'>('comfortable');
  const [filterKind, setFilterKind] = useState<'all' | 'photo' | 'video' | 'favorites' | 'saved'>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [localQuery, setLocalQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(60);
  const [dragOver, setDragOver] = useState(false);

  const [viewerItems, setViewerItems] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [shareTarget, setShareTarget] = useState<CloudFile | null>(null);
  const [saveTarget, setSaveTarget] = useState<SharedMediaEntry | null>(null);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTab(photosInitialTab);
  }, [photosInitialTab]);

  // Ctrl+V clipboard image paste inside Photos
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            const ext = f.type.split('/')[1] || 'png';
            const named = new File([f], `Pasted-Photo-${Date.now()}.${ext}`, { type: f.type });
            pastedFiles.push(named);
          }
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        enqueueUploads(
          pastedFiles.map((file) => ({ file })),
          { destinationLabel: 'Photos', folderId: null, isVault: false }
        );
        pushToast({ kind: 'info', title: `Pasted ${pastedFiles.length} image(s) for upload` });
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [enqueueUploads, pushToast]);

  const monthOptions = useMemo(() => {
    const months = new Map<string, string>();
    for (const f of files) {
      if (f.mediaKind !== 'photo' && f.mediaKind !== 'video') continue;
      const d = new Date(f.takenAt || f.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!months.has(key)) {
        months.set(key, d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
      }
    }
    return Array.from(months.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [files]);

  const myMedia = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const q = localQuery.trim().toLowerCase();

    return files
      .filter((f) => f.mediaKind === 'photo' || f.mediaKind === 'video')
      .filter((f) => {
        if (filterKind === 'photo') return f.mediaKind === 'photo';
        if (filterKind === 'video') return f.mediaKind === 'video';
        if (filterKind === 'favorites') return f.isFavorite;
        if (filterKind === 'saved') return f.savedMode === 'reference' || f.savedMode === 'copy';
        return true;
      })
      .filter((f) => {
        if (!q) return true;
        return (
          f.name.toLowerCase().includes(q) ||
          (f.copiedFromOwnerName || '').toLowerCase().includes(q)
        );
      })
      .filter((f) => {
        if (dateFilter === 'all') return true;
        const ts = new Date(f.takenAt || f.createdAt).getTime();
        if (Number.isNaN(ts)) return false;
        if (dateFilter === 'today') return ts >= todayStart.getTime();
        if (dateFilter === '7d') return ts >= now - 7 * 86400 * 1000;
        if (dateFilter === '30d') return ts >= now - 30 * 86400 * 1000;
        const d = new Date(ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return key === dateFilter;
      });
  }, [files, filterKind, localQuery, dateFilter]);

  const paginatedMedia = myMedia.slice(0, visibleLimit);

  const groupedTimeline = useMemo(() => {
    const groups: Array<{ label: string; items: CloudFile[] }> = [];
    const map = new Map<string, CloudFile[]>();
    for (const item of paginatedMedia) {
      const label = getTimelineGroupLabel(item.takenAt || item.createdAt);
      const list = map.get(label) || [];
      list.push(item);
      map.set(label, list);
    }
    for (const [label, items] of map.entries()) {
      groups.push({ label, items });
    }
    return groups;
  }, [paginatedMedia]);

  const sharedEntries = useMemo<SharedMediaEntry[]>(() => {
    const out: SharedMediaEntry[] = [];
    for (const s of sharesWithMe) {
      if (s.status !== 'accepted') continue;
      const allowCopy = s.allowCopy !== false;
      if (s.file && (s.file.mediaKind === 'photo' || s.file.mediaKind === 'video')) {
        out.push({
          file: s.file,
          shareId: s.shareId,
          ownerName: s.ownerName,
          sharedAt: s.sharedAt,
          permission: s.permission,
          allowCopy,
        });
      }
      if (s.album?.files) {
        for (const af of s.album.files) {
          if (af.mediaKind === 'photo' || af.mediaKind === 'video') {
            out.push({
              file: af,
              shareId: s.shareId,
              ownerName: s.ownerName,
              sharedAt: s.sharedAt,
              permission: s.permission,
              allowCopy,
            });
          }
        }
      }
      if (s.folder?.files) {
        for (const ff of s.folder.files) {
          if (ff.mediaKind === 'photo' || ff.mediaKind === 'video') {
            out.push({
              file: ff,
              shareId: s.shareId,
              ownerName: s.ownerName,
              sharedAt: s.sharedAt,
              permission: s.permission,
              allowCopy,
            });
          }
        }
      }
    }
    return out;
  }, [sharesWithMe]);

  const shareContextMap = useMemo(() => {
    const map: Record<string, { shareId: string; ownerName: string; permission: string; allowCopy: boolean }> = {};
    for (const e of sharedEntries) {
      map[e.file.id] = {
        shareId: e.shareId,
        ownerName: e.ownerName,
        permission: e.permission,
        allowCopy: e.allowCopy,
      };
    }
    return map;
  }, [sharedEntries]);

  const ownedSelectedIds = useMemo(() => {
    const refIds = new Set(files.filter((f) => f.savedMode === 'reference').map((f) => f.id));
    return selectedIds.filter((id) => !refIds.has(id));
  }, [files, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const handleBulkAction = async (action: 'favorite' | 'trash' | 'move_to_vault') => {
    if (ownedSelectedIds.length === 0) {
      pushToast({
        kind: 'info',
        title: 'Shared references cannot be modified',
        description: 'Save an independent copy first or unlink the reference.',
      });
      return;
    }
    if (action === 'move_to_vault' && !vaultUnlocked) {
      pushToast({
        kind: 'info',
        title: 'Unlock Hidden Vault first',
        description: 'Opening Hidden Vault so you can verify your PIN.',
      });
      setActiveNav('vault');
      return;
    }
    await apiFetch('/api/files/bulk', {
      method: 'POST',
      body: JSON.stringify({ action, fileIds: ownedSelectedIds }),
    });
    setSelectedIds([]);
    await Promise.all([
      refreshLibrary(),
      refreshStorage(),
      action === 'move_to_vault' ? refreshVaultItems() : Promise.resolve(),
    ]);
    pushToast({
      kind: 'success',
      title:
        action === 'trash'
          ? 'Moved to Trash'
          : action === 'move_to_vault'
          ? 'Moved to Hidden Vault'
          : 'Updated favorites',
    });
  };

  const downloadSelectedZip = async () => {
    if (ownedSelectedIds.length === 0) return;
    try {
      const token = getAuthToken();
      const res = await fetch('/api/files/download-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ fileIds: ownedSelectedIds, folderIds: [] }),
      });
      if (!res.ok) throw new Error('Download archive failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ASHCLOUD-Photos.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Download failed', description: err?.message });
    }
  };

  const unlinkSavedReference = async (fileId: string, name: string) => {
    await apiFetch(`/api/shares/saved-reference/${fileId}`, { method: 'DELETE' });
    await refreshLibrary();
    pushToast({ kind: 'info', title: 'Removed shared reference', description: name });
  };

  const addSelectedToAlbum = async (albumId: string) => {
    if (ownedSelectedIds.length === 0) return;
    await apiFetch(`/api/albums/${albumId}/items`, {
      method: 'POST',
      body: JSON.stringify({ fileIds: ownedSelectedIds }),
    });
    setAlbumPickerOpen(false);
    setSelectedIds([]);
    await refreshLibrary();
    pushToast({ kind: 'success', title: 'Added photos to album' });
  };

  const handleUploadPick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    enqueueUploads(
      Array.from(list).map((file) => ({ file })),
      { destinationLabel: 'Photos', folderId: null, isVault: false }
    );
  };

  return (
    <div
      className={`space-y-5 min-h-[70vh] rounded-2xl transition-colors ${
        dragOver ? 'ring-2 ring-[#2563EB] bg-[#2563EB]/5 p-2' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleUploadPick(e.dataTransfer.files);
      }}
    >
      {/* Top Bar: Tabs & Import/Upload Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B]">
          {(
            [
              { id: 'my-photos', label: 'My Photos' },
              { id: 'shared-with-me', label: `Shared With Me (${sharedEntries.length})` },
              { id: 'albums', label: `Albums (${albums.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setPhotosInitialTab(t.id);
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                tab === t.id
                  ? 'bg-[#2563EB] text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => handleUploadPick(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Photos & Videos
          </button>
        </div>
      </div>

      {/* Photos Filter & Search Bar */}
      {tab === 'my-photos' && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B]">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={localQuery}
                onChange={(e) => setLocalQuery(e.target.value)}
                placeholder="Filter photos & videos..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B] focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            {/* Media Type Filter */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B]">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'photo', label: 'Photos' },
                  { id: 'video', label: 'Videos' },
                  { id: 'favorites', label: 'Favorites' },
                  { id: 'saved', label: 'Saved Shares' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterKind(f.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filterKind === f.id
                      ? 'bg-[#2563EB] text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#111827] dark:hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Date Filter */}
            <div className="relative inline-flex items-center">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filter by date"
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B]"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                {monthOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Layout mode */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B]">
              <button
                type="button"
                onClick={() => setLayout('comfortable')}
                className={`p-1.5 rounded-lg ${layout === 'comfortable' ? 'bg-[#2563EB] text-white' : 'text-slate-400'}`}
                title="Comfortable grid"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setLayout('compact')}
                className={`p-1.5 rounded-lg ${layout === 'compact' ? 'bg-[#2563EB] text-white' : 'text-slate-400'}`}
                title="Compact grid"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setLayout('mosaic')}
                className={`px-2 py-1 text-[11px] font-medium rounded-lg ${
                  layout === 'mosaic' ? 'bg-[#2563EB] text-white' : 'text-slate-400'
                }`}
                title="Mosaic layout"
              >
                Mosaic
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-select action bar */}
      {selectedIds.length > 0 && (
        <div className="sticky top-20 z-20 p-3 rounded-xl bg-white dark:bg-[#131823] border border-[#2563EB] shadow-xl flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold tabular-nums">{selectedIds.length} selected</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={downloadSelectedZip}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#232B3B] text-xs font-medium hover:bg-slate-50 dark:hover:bg-[#18202F]"
            >
              <Download className="w-3.5 h-3.5 text-[#38BDF8]" />
              Download
            </button>
            <button
              type="button"
              onClick={() => handleBulkAction('favorite')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#232B3B] text-xs font-medium hover:bg-slate-50 dark:hover:bg-[#18202F]"
            >
              <Heart className="w-3.5 h-3.5 text-rose-500" />
              Favorite
            </button>
            <button
              type="button"
              onClick={() => setAlbumPickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#232B3B] text-xs font-medium hover:bg-slate-50 dark:hover:bg-[#18202F]"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#38BDF8]" />
              Add to Album
            </button>
            <button
              type="button"
              onClick={() => handleBulkAction('move_to_vault')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#232B3B] text-xs font-medium hover:bg-slate-50 dark:hover:bg-[#18202F]"
            >
              <Lock className="w-3.5 h-3.5 text-amber-500" />
              Vault
            </button>
            <button
              type="button"
              onClick={() => handleBulkAction('trash')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 text-xs font-medium hover:bg-red-500/20"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Trash
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Tab Content: MY PHOTOS */}
      {tab === 'my-photos' && (
        <>
          {groupedTimeline.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] text-center space-y-3">
              <ImageIcon className="w-10 h-10 text-[#38BDF8] mx-auto" />
              <h3 className="font-display text-base font-semibold">No photos or videos match</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Upload photos or videos from your device, drag and drop files here, or paste an image with Ctrl+V.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Upload Media
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedTimeline.map((group) => (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
                      {group.label}
                    </h2>
                    <span className="text-xs text-slate-400 tabular-nums">
                      {group.items.length} item{group.items.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {layout === 'mosaic' ? (
                    <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 space-y-3">
                      {group.items.map((item) => {
                        const selected = selectedIds.includes(item.id);
                        const globalIdx = myMedia.findIndex((m) => m.id === item.id);
                        const isRef = item.savedMode === 'reference';
                        return (
                          <div
                            key={item.id}
                            className={`break-inside-avoid group relative rounded-xl overflow-hidden border transition-all ${
                              selected
                                ? 'border-[#2563EB] ring-2 ring-[#2563EB]'
                                : 'border-slate-200 dark:border-[#232B3B]'
                            } bg-slate-900`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setViewerItems(myMedia);
                                setViewerIndex(globalIdx >= 0 ? globalIdx : 0);
                              }}
                              className="block w-full text-left"
                            >
                              {item.mediaKind === 'video' ? (
                                <div className="relative aspect-video bg-black flex items-center justify-center">
                                  <video src={item.url} className="w-full h-full object-cover" muted />
                                  <Film className="w-8 h-8 text-white/90 absolute" />
                                </div>
                              ) : (
                                <img
                                  src={item.url}
                                  alt={item.name}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className="w-full h-auto object-cover"
                                />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelect(item.id);
                              }}
                              aria-label={`Select ${item.name}`}
                              className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-full border flex items-center justify-center transition-opacity ${
                                selected
                                  ? 'bg-[#2563EB] border-[#2563EB] text-white opacity-100'
                                  : 'bg-black/45 border-white/60 text-white opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              {selected && <Check className="w-3.5 h-3.5" />}
                            </button>

                            {(isRef || item.savedMode === 'copy') && (
                              <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white font-medium inline-flex items-center gap-1">
                                {isRef ? <Link2 className="w-2.5 h-2.5 text-[#38BDF8]" /> : null}
                                {isRef ? 'Shared Ref' : 'Saved Copy'}
                              </span>
                            )}

                            <div className="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-2 text-white">
                              <span className="text-[11px] font-medium truncate">{item.name}</span>
                              {isRef ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    unlinkSavedReference(item.id, item.name);
                                  }}
                                  className="p-1 rounded hover:bg-white/20"
                                  title="Remove shared reference"
                                >
                                  <Unlink className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShareTarget(item);
                                  }}
                                  className="p-1 rounded hover:bg-white/20"
                                  title="Share"
                                >
                                  <Share2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className={`grid gap-3 ${
                        layout === 'compact'
                          ? 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-7'
                          : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                      }`}
                    >
                      {group.items.map((item) => {
                        const selected = selectedIds.includes(item.id);
                        const globalIdx = myMedia.findIndex((m) => m.id === item.id);
                        const isRef = item.savedMode === 'reference';
                        return (
                          <div
                            key={item.id}
                            className={`group relative aspect-square rounded-xl overflow-hidden border bg-slate-900 ${
                              selected
                                ? 'border-[#2563EB] ring-2 ring-[#2563EB]'
                                : 'border-slate-200 dark:border-[#232B3B]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setViewerItems(myMedia);
                                setViewerIndex(globalIdx >= 0 ? globalIdx : 0);
                              }}
                              className="w-full h-full block"
                            >
                              {item.mediaKind === 'video' ? (
                                <div className="w-full h-full bg-black flex items-center justify-center relative">
                                  <video src={item.url} className="w-full h-full object-cover" muted />
                                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                    <Film className="w-7 h-7 text-white" />
                                  </div>
                                </div>
                              ) : (
                                <img
                                  src={item.url}
                                  alt={item.name}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                                />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelect(item.id);
                              }}
                              aria-label={`Select ${item.name}`}
                              className={`absolute top-2 left-2 w-6 h-6 rounded-full border flex items-center justify-center transition-opacity ${
                                selected
                                  ? 'bg-[#2563EB] border-[#2563EB] text-white opacity-100'
                                  : 'bg-black/45 border-white/60 text-white opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              {selected && <Check className="w-3.5 h-3.5" />}
                            </button>

                            {item.isFavorite && (
                              <Heart className="w-4 h-4 text-rose-500 fill-rose-500 absolute top-2.5 right-2.5 drop-shadow" />
                            )}

                            {(isRef || item.savedMode === 'copy') && !item.isFavorite && (
                              <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-white font-medium inline-flex items-center gap-1">
                                {isRef ? <Link2 className="w-2.5 h-2.5 text-[#38BDF8]" /> : null}
                                {isRef ? 'Shared Ref' : 'Copy'}
                              </span>
                            )}

                            <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-2 text-white">
                              <span className="text-[11px] truncate">{item.name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {isRef ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      unlinkSavedReference(item.id, item.name);
                                    }}
                                    className="p-1 rounded hover:bg-white/20"
                                    title="Unlink shared reference"
                                  >
                                    <Unlink className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShareTarget(item);
                                    }}
                                    className="p-1 rounded hover:bg-white/20"
                                    title="Share"
                                  >
                                    <Share2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <a
                                  href={item.downloadUrl}
                                  download={item.name}
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1 rounded hover:bg-white/20"
                                  title="Download"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}

              {myMedia.length > visibleLimit && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((v) => v + 60)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#232B3B] text-xs font-semibold hover:bg-slate-100 dark:hover:bg-[#18202F]"
                  >
                    Load more ({myMedia.length - visibleLimit} remaining)
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Tab Content: SHARED WITH ME */}
      {tab === 'shared-with-me' && (
        <div className="space-y-4">
          {sharedEntries.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] text-center space-y-2">
              <Share2 className="w-9 h-9 text-[#38BDF8] mx-auto" />
              <div className="text-sm font-semibold">No shared photos yet</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Accepted photo and album shares from other users appear here automatically.
              </p>
              <button
                type="button"
                onClick={() => setActiveNav('shared-with-me')}
                className="mt-2 px-3.5 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-semibold"
              >
                Check Pending Invitations
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {sharedEntries.map((entry, idx) => (
                <div
                  key={`${entry.shareId}-${entry.file.id}-${idx}`}
                  className="rounded-xl overflow-hidden bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] hover:border-[#2563EB] transition-colors flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setViewerItems(sharedEntries.map((e) => e.file));
                      setViewerIndex(idx);
                    }}
                    className="aspect-square bg-slate-900 overflow-hidden block w-full relative"
                  >
                    {entry.file.mediaKind === 'video' ? (
                      <div className="w-full h-full flex items-center justify-center bg-black">
                        <video src={entry.file.url} className="w-full h-full object-cover" muted />
                        <Film className="w-7 h-7 text-white absolute" />
                      </div>
                    ) : (
                      <img
                        src={entry.file.url}
                        alt={entry.file.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover hover:scale-[1.03] transition-transform"
                      />
                    )}
                  </button>
                  <div className="p-3 space-y-2.5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="text-xs font-semibold truncate">{entry.file.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        By {entry.ownerName} · <span className="capitalize">{entry.permission}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 tabular-nums mt-0.5">
                        Shared {formatShortDate(entry.sharedAt)} · {formatBytes(entry.file.sizeBytes)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSaveTarget(entry)}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-[#2563EB]/15 hover:bg-[#2563EB] text-[#2563EB] dark:text-[#38BDF8] hover:text-white text-xs font-semibold transition-colors"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      Save to My Photos
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: ALBUMS */}
      {tab === 'albums' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {albums.map((alb) => (
            <button
              key={alb.id}
              type="button"
              onClick={() => {
                if (onOpenAlbumsTab) {
                  onOpenAlbumsTab();
                } else {
                  setActiveNav('albums');
                }
              }}
              className="text-left rounded-2xl overflow-hidden bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] hover:border-[#2563EB] transition-colors"
            >
              <div className="aspect-[16/10] bg-slate-200 dark:bg-[#0B0E14] overflow-hidden flex items-center justify-center">
                {alb.coverUrl ? (
                  <img
                    src={alb.coverUrl}
                    alt={alb.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-slate-400" />
                )}
              </div>
              <div className="p-4">
                <div className="text-sm font-semibold truncate">{alb.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                  {alb.itemCount} item{alb.itemCount === 1 ? '' : 's'}
                </div>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setActiveNav('albums')}
            className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-[#232B3B] p-8 flex flex-col items-center justify-center gap-2 text-xs font-semibold text-slate-500 hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
          >
            <Plus className="w-5 h-5" />
            Manage & Create Albums
          </button>
        </div>
      )}

      {/* Album Picker Modal */}
      {albumPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold">Add {ownedSelectedIds.length} item(s) to Album</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {albums.map((alb) => (
                <button
                  key={alb.id}
                  type="button"
                  onClick={() => addSelectedToAlbum(alb.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 dark:border-[#232B3B] hover:border-[#2563EB] text-xs font-medium flex items-center justify-between"
                >
                  <span className="truncate">{alb.title}</span>
                  <span className="text-slate-400 tabular-nums">{alb.itemCount}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAlbumPickerOpen(false)}
              className="w-full py-2 rounded-xl border border-slate-200 dark:border-[#232B3B] text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {viewerItems && (
        <MediaViewerModal
          items={viewerItems}
          initialIndex={viewerIndex}
          onClose={() => setViewerItems(null)}
          shareContextByFileId={shareContextMap}
        />
      )}

      {shareTarget && (
        <ShareModal
          resourceType="file"
          resourceId={shareTarget.id}
          resourceName={shareTarget.name}
          isVault={shareTarget.isVault}
          onClose={() => setShareTarget(null)}
        />
      )}

      {saveTarget && (
        <SaveToMyPhotosModal
          file={saveTarget.file}
          shareId={saveTarget.shareId}
          ownerName={saveTarget.ownerName}
          permission={saveTarget.permission}
          allowCopy={saveTarget.allowCopy}
          onClose={() => setSaveTarget(null)}
        />
      )}
    </div>
  );
}
