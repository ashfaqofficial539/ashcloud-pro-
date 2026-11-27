import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowLeft,
  Clock,
  Edit3,
  FileText,
  Folder,
  Heart,
  Image as ImageIcon,
  Layers,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';
import { formatBytes, formatRelativeTime, formatShortDate } from '../lib/format';
import type { Album, CloudFile, SearchResultItem } from '../types';
import { MediaViewerModal } from './MediaViewerModal';
import { ShareModal } from './ShareModal';

// --- 1. ALBUMS VIEW ---
export function AlbumsView() {
  const { albums, files, refreshLibrary, pushToast } = useAshcloud();
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [addPhotosOpen, setAddPhotosOpen] = useState(false);
  const [shareAlbum, setShareAlbum] = useState<Album | null>(null);
  const [viewerItems, setViewerItems] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const mediaFiles = useMemo(
    () => files.filter((f) => f.mediaKind === 'photo' || f.mediaKind === 'video'),
    [files]
  );

  const activeAlbum = albums.find((a) => a.id === selectedAlbumId) || null;
  const albumFiles = useMemo(() => {
    if (!activeAlbum) return [];
    const idSet = new Set(activeAlbum.fileIds);
    return files.filter((f) => idSet.has(f.id));
  }, [activeAlbum, files]);

  const createAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await apiFetch('/api/albums', {
      method: 'POST',
      body: JSON.stringify({ title: newTitle.trim(), description: newDesc.trim(), fileIds: pickedIds }),
    });
    setNewTitle('');
    setNewDesc('');
    setPickedIds([]);
    setCreateOpen(false);
    await refreshLibrary();
    pushToast({ kind: 'success', title: 'Album created' });
  };

  if (activeAlbum) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedAlbumId(null)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="font-display text-xl font-bold">{activeAlbum.title}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activeAlbum.description || 'Personal photo album'} · {albumFiles.length} item(s)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPickedIds([]);
                setAddPhotosOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" /> Add Photos
            </button>
            <button
              type="button"
              onClick={() => setShareAlbum(activeAlbum)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
            >
              <Share2 className="w-3.5 h-3.5" /> Share Album
            </button>
            <button
              type="button"
              onClick={async () => {
                await apiFetch(`/api/albums/${activeAlbum.id}`, { method: 'DELETE' });
                setSelectedAlbumId(null);
                await refreshLibrary();
                pushToast({ kind: 'info', title: 'Album deleted' });
              }}
              className="p-2 rounded-lg bg-red-500/10 text-red-500"
              title="Delete album"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {albumFiles.length === 0 ? (
          <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
            This album has no photos yet. Click “Add Photos” above.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {albumFiles.map((f, idx) => (
              <div key={f.id} className="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900">
                <button
                  type="button"
                  onClick={() => {
                    setViewerItems(albumFiles);
                    setViewerIndex(idx);
                  }}
                  className="aspect-square w-full block"
                >
                  <img src={f.url} alt={f.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                </button>
                <div className="p-2.5 bg-white dark:bg-[#1F2937] flex items-center justify-between gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/albums/${activeAlbum.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ coverFileId: f.id }),
                      });
                      await refreshLibrary();
                      pushToast({ kind: 'success', title: 'Album cover updated' });
                    }}
                    className="text-[#2563EB] dark:text-[#38BDF8] hover:underline"
                  >
                    {activeAlbum.coverFileId === f.id ? 'Cover' : 'Set cover'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/albums/${activeAlbum.id}/items/${f.id}`, { method: 'DELETE' });
                      await refreshLibrary();
                    }}
                    className="text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {addPhotosOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 p-5 space-y-4">
              <h3 className="font-display text-base font-semibold">Add Photos to “{activeAlbum.title}”</h3>
              <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
                {mediaFiles.map((mf) => {
                  const sel = pickedIds.includes(mf.id);
                  return (
                    <button
                      key={mf.id}
                      type="button"
                      onClick={() =>
                        setPickedIds((prev) => (sel ? prev.filter((id) => id !== mf.id) : [...prev, mf.id]))
                      }
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 ${
                        sel ? 'border-[#2563EB]' : 'border-transparent'
                      }`}
                    >
                      <img src={mf.url} alt={mf.name} className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddPhotosOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/albums/${activeAlbum.id}/items`, {
                      method: 'POST',
                      body: JSON.stringify({ fileIds: pickedIds }),
                    });
                    setAddPhotosOpen(false);
                    await refreshLibrary();
                    pushToast({ kind: 'success', title: 'Photos added to album' });
                  }}
                  className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
                >
                  Add ({pickedIds.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {shareAlbum && (
          <ShareModal
            resourceType="album"
            resourceId={shareAlbum.id}
            resourceName={shareAlbum.title}
            onClose={() => setShareAlbum(null)}
          />
        )}

        {viewerItems && (
          <MediaViewerModal items={viewerItems} initialIndex={viewerIndex} onClose={() => setViewerItems(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold">Albums</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Organize memories into curated collections and share with collaborators.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          New Album
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {albums.map((alb) => (
          <div
            key={alb.id}
            className="rounded-2xl overflow-hidden bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 hover:border-[#2563EB] transition-colors flex flex-col"
          >
            <button
              type="button"
              onClick={() => setSelectedAlbumId(alb.id)}
              className="aspect-[16/10] bg-slate-100 dark:bg-[#111827] overflow-hidden flex items-center justify-center"
            >
              {alb.coverUrl ? (
                <img src={alb.coverUrl} alt={alb.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              ) : (
                <Layers className="w-8 h-8 text-slate-400" />
              )}
            </button>
            <div className="p-4 flex items-center justify-between gap-2">
              <button type="button" onClick={() => setSelectedAlbumId(alb.id)} className="text-left min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{alb.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                  {alb.itemCount} item{alb.itemCount === 1 ? '' : 's'}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setShareAlbum(alb)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#38BDF8]"
                title="Share album"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <form
            onSubmit={createAlbum}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold">Create Album</h3>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Album title"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold">
                Create Album
              </button>
            </div>
          </form>
        </div>
      )}

      {shareAlbum && (
        <ShareModal
          resourceType="album"
          resourceId={shareAlbum.id}
          resourceName={shareAlbum.title}
          onClose={() => setShareAlbum(null)}
        />
      )}
    </div>
  );
}

// --- 2. FAVORITES VIEW ---
export function FavoritesView() {
  const { files, refreshLibrary } = useAshcloud();
  const [viewerItems, setViewerItems] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const favFiles = useMemo(() => files.filter((f) => f.isFavorite), [files]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg font-bold">Favorites</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {favFiles.length} starred photo(s) and file(s)
        </p>
      </div>

      {favFiles.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Heart className="w-9 h-9 text-rose-500 mx-auto" />
          <div className="text-sm font-semibold">No favorite items yet</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Star photos or documents from Photos or Drive for quick access here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {favFiles.map((f, idx) => (
            <div key={f.id} className="rounded-xl overflow-hidden bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setViewerItems(favFiles);
                  setViewerIndex(idx);
                }}
                className="aspect-[4/3] w-full bg-slate-100 dark:bg-[#111827] flex items-center justify-center overflow-hidden"
              >
                {f.mediaKind === 'photo' ? (
                  <img src={f.url} alt={f.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  <FileText className="w-8 h-8 text-[#38BDF8]" />
                )}
              </button>
              <div className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{f.name}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">{formatBytes(f.sizeBytes)}</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/files/${f.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isFavorite: false }),
                    });
                    await refreshLibrary();
                  }}
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="Remove favorite"
                >
                  <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewerItems && (
        <MediaViewerModal items={viewerItems} initialIndex={viewerIndex} onClose={() => setViewerItems(null)} />
      )}
    </div>
  );
}

// --- 3. RECENT VIEW ---
export function RecentView() {
  const { files } = useAshcloud();
  const [viewerItems, setViewerItems] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const recentFiles = useMemo(() => {
    return [...files]
      .sort(
        (a, b) =>
          new Date(b.lastOpenedAt || b.updatedAt).getTime() -
          new Date(a.lastOpenedAt || a.updatedAt).getTime()
      )
      .slice(0, 30);
  }, [files]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg font-bold">Recent Files</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Recently uploaded, opened, and modified items
        </p>
      </div>

      {recentFiles.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
          No recent files yet.
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
          {recentFiles.map((f, idx) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setViewerItems(recentFiles);
                setViewerIndex(idx);
              }}
              className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-[#111827]/60 text-left transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Clock className="w-4 h-4 text-[#38BDF8] shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{f.name}</div>
                  <div className="text-[11px] text-slate-400 capitalize">
                    {f.mediaKind} · {f.lastOpenedAt ? `Opened ${formatRelativeTime(f.lastOpenedAt)}` : `Uploaded ${formatRelativeTime(f.createdAt)}`}
                  </div>
                </div>
              </div>
              <span className="font-mono text-xs text-slate-400 tabular-nums shrink-0">
                {formatBytes(f.sizeBytes)}
              </span>
            </button>
          ))}
        </div>
      )}

      {viewerItems && (
        <MediaViewerModal items={viewerItems} initialIndex={viewerIndex} onClose={() => setViewerItems(null)} />
      )}
    </div>
  );
}

// --- 4. TRASH VIEW ---
export function TrashView() {
  const { trashedFiles, trashedFolders, refreshLibrary, refreshStorage, pushToast } = useAshcloud();

  const emptyTrash = async () => {
    if (trashedFiles.length > 0) {
      await apiFetch('/api/files/bulk', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_permanent', fileIds: trashedFiles.map((f) => f.id) }),
      });
    }
    for (const fld of trashedFolders) {
      await apiFetch(`/api/folders/${fld.id}`, { method: 'DELETE' });
    }
    await Promise.all([refreshLibrary(), refreshStorage()]);
    pushToast({ kind: 'info', title: 'Trash emptied' });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-lg font-bold">Trash</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Restore deleted items or permanently purge storage objects.
          </p>
        </div>
        {(trashedFiles.length > 0 || trashedFolders.length > 0) && (
          <button
            type="button"
            onClick={emptyTrash}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 text-xs font-semibold"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Empty Trash
          </button>
        )}
      </div>

      {trashedFiles.length === 0 && trashedFolders.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Trash2 className="w-9 h-9 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold">Trash is empty</div>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
          {trashedFolders.map((fld) => (
            <div key={fld.id} className="px-4 py-3 flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3 min-w-0">
                <Folder className="w-4 h-4 text-[#38BDF8] shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{fld.name}</div>
                  <div className="text-[11px] text-slate-400">Folder · Deleted {formatShortDate(fld.trashedAt)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/folders/${fld.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isTrashed: false }),
                    });
                    await Promise.all([refreshLibrary(), refreshStorage()]);
                    pushToast({ kind: 'success', title: 'Folder restored' });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/folders/${fld.id}`, { method: 'DELETE' });
                    await Promise.all([refreshLibrary(), refreshStorage()]);
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-red-500 hover:bg-red-500/10 font-semibold"
                >
                  Delete Forever
                </button>
              </div>
            </div>
          ))}

          {trashedFiles.map((f) => (
            <div key={f.id} className="px-4 py-3 flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{f.name}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">
                    {formatBytes(f.sizeBytes)} · Deleted {formatShortDate(f.trashedAt)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/files/${f.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isTrashed: false }),
                    });
                    await Promise.all([refreshLibrary(), refreshStorage()]);
                    pushToast({ kind: 'success', title: 'File restored' });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/files/bulk', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'delete_permanent', fileIds: [f.id] }),
                    });
                    await Promise.all([refreshLibrary(), refreshStorage()]);
                    pushToast({ kind: 'info', title: 'Permanently deleted' });
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-red-500 hover:bg-red-500/10 font-semibold"
                >
                  Delete Forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- 5. GLOBAL SEARCH VIEW ---
export function SearchView() {
  const { globalSearchQuery, setGlobalSearchQuery, setActiveNav } = useAshcloud();
  const [typeFilter, setTypeFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewerItems, setViewerItems] = useState<CloudFile[] | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({
        q: globalSearchQuery,
        type: typeFilter,
        scope: scopeFilter,
      });
      apiFetch<{ results: SearchResultItem[] }>(`/api/search?${params.toString()}`)
        .then((res) => setResults(res.results || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [globalSearchQuery, typeFilter, scopeFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-lg font-bold">Global Search</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Searches My Photos, My Drive, Albums, and accepted Shared With Me items (Hidden Vault excluded).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700"
          >
            <option value="all">All Accessible</option>
            <option value="mine">My Library Only</option>
            <option value="shared">Shared With Me</option>
            <option value="favorites">Favorites</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700"
          >
            <option value="all">All Types</option>
            <option value="photo">Photos</option>
            <option value="video">Videos</option>
            <option value="document">Documents</option>
            <option value="folder">Folders</option>
            <option value="album">Albums</option>
          </select>
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={globalSearchQuery}
          onChange={(e) => setGlobalSearchQuery(e.target.value)}
          placeholder="Filter by file, folder, or album name..."
          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700"
        />
      </div>

      {loading ? (
        <div className="text-xs text-slate-400">Searching accessible library...</div>
      ) : results.length === 0 ? (
        <div className="p-10 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
          No matching items found.
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
          {results.map((r, idx) => (
            <button
              key={`${r.resultType}-${r.item.id}-${idx}`}
              type="button"
              onClick={() => {
                if (r.resultType === 'file') {
                  setViewerItems([r.item]);
                } else if (r.resultType === 'folder') {
                  setActiveNav('drive');
                } else {
                  setActiveNav('albums');
                }
              }}
              className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-[#111827]/60 text-left transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                {r.resultType === 'file' && r.item.mediaKind === 'photo' ? (
                  <img
                    src={r.item.url}
                    alt={r.item.name}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                  />
                ) : r.resultType === 'folder' ? (
                  <Folder className="w-5 h-5 text-[#38BDF8] shrink-0" />
                ) : r.resultType === 'album' ? (
                  <Layers className="w-5 h-5 text-[#2563EB] shrink-0" />
                ) : (
                  <FileText className="w-5 h-5 text-emerald-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{r.item.name || r.item.title}</div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span>{r.location}</span>
                    <span aria-hidden="true">·</span>
                    <span>{r.sharingStatus}</span>
                    {(r.item.ownerName || r.ownerName) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{r.item.ownerName || r.ownerName}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {r.item.sizeBytes !== undefined && (
                <span className="font-mono text-xs text-slate-400 tabular-nums shrink-0">
                  {formatBytes(r.item.sizeBytes)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {viewerItems && (
        <MediaViewerModal items={viewerItems} initialIndex={0} onClose={() => setViewerItems(null)} />
      )}
    </div>
  );
}

// --- 6. ACTIVITY VIEW ---
export function ActivityView() {
  const { activity } = useAshcloud();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg font-bold">Activity</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Audit timeline for uploads, Google imports, shares, and saved items.
        </p>
      </div>

      {activity.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] text-center space-y-2">
          <ActivityIcon className="w-9 h-9 text-[#38BDF8] mx-auto" />
          <div className="text-sm font-semibold">No activity recorded yet</div>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] divide-y divide-slate-100 dark:divide-[#232B3B]">
          {activity.map((item) => (
            <div key={item.id} className="px-4 py-3.5 flex items-start justify-between gap-4 text-xs">
              <div className="min-w-0">
                <div className="font-semibold">
                  {item.action} <span className="text-[#2563EB] dark:text-[#38BDF8]">{item.targetName}</span>
                </div>
                {item.details && (
                  <div className="text-slate-500 dark:text-slate-400 mt-0.5">{item.details}</div>
                )}
              </div>
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                {formatRelativeTime(item.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- 7. SETTINGS VIEW ---
export function SettingsView() {
  const {
    user,
    demoAccounts,
    demoLogin,
    logout,
    theme,
    setTheme,
    refreshProfile,
    pushToast,
  } = useAshcloud();

  const [name, setName] = useState(user?.name || '');
  const [language, setLanguage] = useState(user?.languagePref || 'en');
  const [uploadQuality, setUploadQuality] = useState<'original' | 'high'>(user?.uploadQuality || 'original');
  const [notifyShares, setNotifyShares] = useState(Boolean(user?.notifyShares));
  const [notifyUploads, setNotifyUploads] = useState(Boolean(user?.notifyUploads));
  const [autoLockMins, setAutoLockMins] = useState(user?.vaultAutoLockMinutes || 15);
  const [sessions, setSessions] = useState<
    Array<{ id: string; deviceInfo: string; lastActiveAt: string; isCurrent: boolean }>
  >([]);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    apiFetch<{ sessions: any[] }>('/api/auth/sessions')
      .then((res) => setSessions(res.sessions || []))
      .catch(() => {});
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        name,
        themePref: theme,
        languagePref: language,
        uploadQuality,
        notifyShares,
        notifyUploads,
        vaultAutoLockMinutes: Number(autoLockMins),
      }),
    });
    await refreshProfile();
    pushToast({ kind: 'success', title: 'Settings saved' });
  };

  const changePin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/vault/change-pin', {
        method: 'POST',
        body: JSON.stringify({ currentPin, newPin }),
      });
      setCurrentPin('');
      setNewPin('');
      pushToast({ kind: 'success', title: 'Vault PIN updated' });
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'PIN update failed', description: err?.message });
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <form
        onSubmit={saveProfile}
        className="p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-5"
      >
        <h2 className="font-display text-base font-semibold">Profile & Preferences</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
            <input
              type="text"
              disabled
              value={user?.email || ''}
              className="w-full px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-[#111827]/60 border border-slate-200 dark:border-slate-800 text-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            >
              <option value="dark">Dark Mode (Deep Navy #111827)</option>
              <option value="light">Light Mode (Cloud White #F8FAFC)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="ar">العربية</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Upload Quality</label>
            <select
              value={uploadQuality}
              onChange={(e) => setUploadQuality(e.target.value as any)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            >
              <option value="original">Original Quality (Lossless)</option>
              <option value="high">High Efficiency</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Vault Auto-Lock (Minutes)</label>
            <input
              type="number"
              min={1}
              max={120}
              value={autoLockMins}
              onChange={(e) => setAutoLockMins(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6 pt-2 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={notifyShares} onChange={(e) => setNotifyShares(e.target.checked)} className="accent-[#2563EB]" />
            Notify on sharing invitations & responses
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={notifyUploads} onChange={(e) => setNotifyUploads(e.target.checked)} className="accent-[#2563EB]" />
            Notify on upload & storage alerts
          </label>
        </div>

        <button type="submit" className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold">
          Save Preferences
        </button>
      </form>

      {user?.hasVaultPin && (
        <form
          onSubmit={changePin}
          className="p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-4"
        >
          <h2 className="font-display text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#38BDF8]" />
            Change Hidden Vault PIN
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="password"
              inputMode="numeric"
              required
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Current PIN"
              className="px-3 py-2 text-sm font-mono rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
            <input
              type="password"
              inputMode="numeric"
              required
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder="New PIN (4–8 digits)"
              className="px-3 py-2 text-sm font-mono rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold">
            Update Vault PIN
          </button>
        </form>
      )}

      <div className="p-6 rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Active Sessions & Account Switching</h2>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:underline"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Signing out ends only your current browser session. All images and files will be stored on this website permanently and will remain available even after signing out of an account.
        </p>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {sessions.map((s) => (
            <div key={s.id} className="py-2.5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {s.deviceInfo} {s.isCurrent ? '(Current Session)' : ''}
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  Last active {formatRelativeTime(s.lastActiveAt)}
                </div>
              </div>
              {!s.isCurrent && (
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/auth/sessions/${s.id}`, { method: 'DELETE' });
                    setSessions((prev) => prev.filter((item) => item.id !== s.id));
                  }}
                  className="text-red-500 hover:underline shrink-0"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>

        {demoAccounts.filter((a) => a.email !== user?.email).length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Switch Workspace Account
            </div>
            <div className="flex flex-wrap gap-2">
              {demoAccounts
                .filter((a) => a.email !== user?.email)
                .map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => demoLogin(acc.email)}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:border-[#2563EB]"
                  >
                    Switch to {acc.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
