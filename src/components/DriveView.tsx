import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Edit3,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  FolderUp,
  Grid,
  Heart,
  Image as ImageIcon,
  List,
  Lock,
  Move,
  Scissors,
  Share2,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch, getAuthToken } from '../lib/api';
import { formatBytes, formatShortDate } from '../lib/format';
import type { CloudFile, CloudFolder } from '../types';
import { MediaViewerModal } from './MediaViewerModal';
import { ShareModal } from './ShareModal';
import { SharingView } from './SharingView';

export function DriveView() {
  const {
    files,
    folders,
    driveInitialTab,
    setDriveInitialTab,
    enqueueUploads,
    refreshLibrary,
    refreshStorage,
    refreshVaultItems,
    vaultUnlocked,
    setActiveNav,
    clipboard,
    setClipboard,
    pushToast,
  } = useAshcloud();

  const [tab, setTab] = useState<'my-drive' | 'shared-with-me' | 'shared-by-me'>(driveInitialTab);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date' | 'type'>('name');
  const [typeFilter, setTypeFilter] = useState<'all' | 'document' | 'photo' | 'video' | 'archive'>('all');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveDestFolderId, setMoveDestFolderId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<{ type: 'file' | 'folder'; id: string; name: string; isVault?: boolean } | null>(null);
  const [viewerFiles, setViewerFiles] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTab(driveInitialTab);
  }, [driveInitialTab]);

  // Breadcrumb path
  const breadcrumbs = useMemo(() => {
    const chain: CloudFolder[] = [];
    let curr = currentFolderId;
    let guard = 0;
    while (curr && guard < 24) {
      const found = folders.find((f) => f.id === curr);
      if (!found) break;
      chain.unshift(found);
      curr = found.parentId;
      guard += 1;
    }
    return chain;
  }, [currentFolderId, folders]);

  const currentFolderName = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : 'My Drive';

  const childFolders = useMemo(() => {
    return folders
      .filter((f) => f.parentId === currentFolderId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, currentFolderId]);

  const childFiles = useMemo(() => {
    return files
      .filter((f) => f.folderId === currentFolderId)
      .filter((f) => (typeFilter === 'all' ? true : f.mediaKind === typeFilter))
      .sort((a, b) => {
        if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
        if (sortBy === 'date') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (sortBy === 'type') return a.mediaKind.localeCompare(b.mediaKind);
        return a.name.localeCompare(b.name);
      });
  }, [files, currentFolderId, typeFilter, sortBy]);

  const pasteClipboardHere = useCallback(async () => {
    if (!clipboard || clipboard.fileIds.length === 0) return;
    const action = clipboard.mode === 'cut' ? 'move' : 'copy';
    await apiFetch('/api/files/bulk', {
      method: 'POST',
      body: JSON.stringify({
        action,
        fileIds: clipboard.fileIds,
        targetFolderId: currentFolderId,
      }),
    });
    if (clipboard.mode === 'cut') setClipboard(null);
    await Promise.all([refreshLibrary(), refreshStorage()]);
    pushToast({
      kind: 'success',
      title: action === 'move' ? 'Moved files here' : 'Copied files here',
    });
  }, [clipboard, currentFolderId, pushToast, refreshLibrary, refreshStorage, setClipboard]);

  const deleteSelected = useCallback(async () => {
    if (selectedFileIds.length === 0) return;
    await apiFetch('/api/files/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'trash', fileIds: selectedFileIds }),
    });
    setSelectedFileIds([]);
    await Promise.all([refreshLibrary(), refreshStorage()]);
    pushToast({ kind: 'info', title: 'Moved selected items to Trash' });
  }, [pushToast, refreshLibrary, refreshStorage, selectedFileIds]);

  // Keyboard shortcuts (Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A, Delete, Ctrl+U, Ctrl+Shift+N)
  useEffect(() => {
    if (tab !== 'my-drive') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'c' && selectedFileIds.length > 0) {
        e.preventDefault();
        setClipboard({ mode: 'copy', fileIds: selectedFileIds });
        pushToast({ kind: 'info', title: `Copied ${selectedFileIds.length} file(s)` });
      } else if (ctrl && e.key.toLowerCase() === 'x' && selectedFileIds.length > 0) {
        e.preventDefault();
        setClipboard({ mode: 'cut', fileIds: selectedFileIds });
        pushToast({ kind: 'info', title: `Cut ${selectedFileIds.length} file(s)` });
      } else if (ctrl && e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault();
        pasteClipboardHere().catch(() => {});
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedFileIds(childFiles.map((f) => f.id));
      } else if (e.key === 'Delete' && selectedFileIds.length > 0) {
        e.preventDefault();
        deleteSelected().catch(() => {});
      } else if (ctrl && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        fileInputRef.current?.click();
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewFolderOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, selectedFileIds, clipboard, childFiles, setClipboard, pushToast, pasteClipboardHere, deleteSelected]);

  const handleUploadFiles = (fileList: FileList | null, withRelativePath = false) => {
    if (!fileList || fileList.length === 0) return;
    const payload = Array.from(fileList).map((file) => ({
      file,
      relativePath: withRelativePath ? (file as any).webkitRelativePath || file.name : undefined,
    }));
    enqueueUploads(payload, {
      destinationLabel: currentFolderName,
      folderId: currentFolderId,
      isVault: false,
    });
  };

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await apiFetch('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name: newFolderName.trim(), parentId: currentFolderId, isVault: false }),
    });
    setNewFolderName('');
    setNewFolderOpen(false);
    await Promise.all([refreshLibrary(), refreshStorage()]);
    pushToast({ kind: 'success', title: 'Folder created' });
  };

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameTarget.name.trim()) return;
    const url = renameTarget.kind === 'file' ? `/api/files/${renameTarget.id}` : `/api/folders/${renameTarget.id}`;
    await apiFetch(url, {
      method: 'PATCH',
      body: JSON.stringify({ name: renameTarget.name.trim() }),
    });
    setRenameTarget(null);
    await refreshLibrary();
    pushToast({ kind: 'success', title: 'Renamed successfully' });
  };

  const downloadZip = async (fIds: string[], fldIds: string[]) => {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/files/download-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ fileIds: fIds, folderIds: fldIds }),
      });
      if (!res.ok) throw new Error('ZIP export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ASHCLOUD-Archive.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'ZIP failed', description: err?.message });
    }
  };

  const renderFileIcon = (kind: string) => {
    if (kind === 'photo') return <ImageIcon className="w-4 h-4 text-[#38BDF8]" />;
    if (kind === 'video') return <Video className="w-4 h-4 text-[#2563EB]" />;
    if (kind === 'archive') return <Archive className="w-4 h-4 text-amber-500" />;
    if (kind === 'document') return <FileText className="w-4 h-4 text-emerald-500" />;
    return <FileIcon className="w-4 h-4 text-slate-400" />;
  };

  return (
    <div className="space-y-5">
      {/* Top Drive Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800">
          {(
            [
              { id: 'my-drive', label: 'My Drive' },
              { id: 'shared-with-me', label: 'Shared With Me' },
              { id: 'shared-by-me', label: 'Shared By Me' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setDriveInitialTab(t.id);
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

        {tab === 'my-drive' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setNewFolderOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1F2937] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#38BDF8]" />
              New Folder
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleUploadFiles(e.target.files, false)}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as any)}
              className="hidden"
              onChange={(e) => handleUploadFiles(e.target.files, true)}
            />

            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1F2937] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <FolderUp className="w-3.5 h-3.5 text-amber-500" />
              Upload Folder
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Files
            </button>
          </div>
        )}
      </div>

      {tab === 'shared-with-me' && <SharingView mode="with-me" />}
      {tab === 'shared-by-me' && <SharingView mode="by-me" />}

      {tab === 'my-drive' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleUploadFiles(e.dataTransfer.files, false);
          }}
          className={`space-y-4 rounded-2xl transition-colors ${
            dragOver ? 'ring-2 ring-[#2563EB] bg-[#2563EB]/5 p-2' : ''
          }`}
        >
          {/* Breadcrumbs + Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5">
            <nav className="flex items-center gap-1 text-xs font-medium overflow-x-auto">
              <button
                type="button"
                onClick={() => {
                  setCurrentFolderId(null);
                  setSelectedFileIds([]);
                }}
                className={`px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap ${
                  currentFolderId === null ? 'text-[#2563EB] dark:text-[#38BDF8] font-semibold' : 'text-slate-500'
                }`}
              >
                My Drive
              </button>
              {breadcrumbs.map((b) => (
                <React.Fragment key={b.id}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolderId(b.id);
                      setSelectedFileIds([]);
                    }}
                    className={`px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap ${
                      currentFolderId === b.id ? 'text-[#2563EB] dark:text-[#38BDF8] font-semibold' : 'text-slate-500'
                    }`}
                  >
                    {b.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              {clipboard && (
                <button
                  type="button"
                  onClick={pasteClipboardHere}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#2563EB]/10 text-[#2563EB] dark:text-[#38BDF8] text-xs font-semibold whitespace-nowrap"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Paste ({clipboard.fileIds.length})
                </button>
              )}
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="px-2.5 py-1 text-xs rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
              >
                <option value="all">All Types</option>
                <option value="document">Documents</option>
                <option value="photo">Images</option>
                <option value="video">Videos</option>
                <option value="archive">Archives</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-2.5 py-1 text-xs rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
              >
                <option value="name">Sort: Name</option>
                <option value="date">Sort: Date</option>
                <option value="size">Sort: Size</option>
                <option value="type">Sort: Type</option>
              </select>
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-[#2563EB] text-white' : 'text-slate-400'}`}
                  aria-label="List view"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[#2563EB] text-white' : 'text-slate-400'}`}
                  aria-label="Grid view"
                >
                  <Grid className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Selection Action Bar */}
          {selectedFileIds.length > 0 && (
            <div className="p-3 rounded-xl bg-white dark:bg-[#1F2937] border border-[#2563EB] flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold tabular-nums">{selectedFileIds.length} selected</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setClipboard({ mode: 'copy', fileIds: selectedFileIds });
                    pushToast({ kind: 'info', title: 'Copied to Drive clipboard' });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClipboard({ mode: 'cut', fileIds: selectedFileIds });
                    pushToast({ kind: 'info', title: 'Cut to Drive clipboard' });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  <Scissors className="w-3.5 h-3.5" /> Cut
                </button>
                <button
                  type="button"
                  onClick={() => setMoveModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  <Move className="w-3.5 h-3.5" /> Move
                </button>
                <button
                  type="button"
                  onClick={() => downloadZip(selectedFileIds, [])}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  <Download className="w-3.5 h-3.5" /> Download ZIP
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!vaultUnlocked) {
                      setActiveNav('vault');
                      return;
                    }
                    await apiFetch('/api/files/bulk', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'move_to_vault', fileIds: selectedFileIds }),
                    });
                    setSelectedFileIds([]);
                    await Promise.all([refreshLibrary(), refreshStorage(), refreshVaultItems()]);
                    pushToast({ kind: 'success', title: 'Moved to Hidden Vault' });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-500" /> Vault
                </button>
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-500 text-xs font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Trash
                </button>
              </div>
            </div>
          )}

          {/* Folders Section */}
          {childFolders.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Folders</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {childFolders.map((fld) => (
                  <div
                    key={fld.id}
                    className="group p-3.5 rounded-xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 hover:border-[#2563EB] transition-colors flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentFolderId(fld.id);
                        setSelectedFileIds([]);
                      }}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                    >
                      <Folder className="w-5 h-5 text-[#38BDF8] fill-[#38BDF8]/20 shrink-0" />
                      <span className="text-sm font-medium truncate">{fld.name}</span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShareTarget({ type: 'folder', id: fld.id, name: fld.name, isVault: fld.isVault })}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#38BDF8]"
                        title="Share folder"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadZip([], [fld.id])}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#2563EB]"
                        title="Download folder as ZIP"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenameTarget({ kind: 'folder', id: fld.id, name: fld.name })}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                        title="Rename folder"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/folders/${fld.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ isTrashed: true }),
                          });
                          await Promise.all([refreshLibrary(), refreshStorage()]);
                          pushToast({ kind: 'info', title: 'Folder moved to Trash' });
                        }}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-500"
                        title="Move folder to Trash"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files View */}
          {childFiles.length === 0 && childFolders.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center space-y-3">
              <Folder className="w-10 h-10 text-[#38BDF8] mx-auto" />
              <div className="text-sm font-semibold">This folder is empty</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Upload files, upload an entire folder, or drag and drop items into {currentFolderName}.
              </p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={childFiles.length > 0 && selectedFileIds.length === childFiles.length}
                        onChange={(e) =>
                          setSelectedFileIds(e.target.checked ? childFiles.map((f) => f.id) : [])
                        }
                        aria-label="Select all files"
                      />
                    </th>
                    <th className="py-3 px-3">Name</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3 text-right">Size</th>
                    <th className="py-3 px-3">Modified</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {childFiles.map((f, idx) => {
                    const checked = selectedFileIds.includes(f.id);
                    return (
                      <tr
                        key={f.id}
                        className={`hover:bg-slate-50 dark:hover:bg-[#111827]/60 transition-colors ${
                          checked ? 'bg-[#2563EB]/5' : ''
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedFileIds((prev) =>
                                prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]
                              )
                            }
                            aria-label={`Select ${f.name}`}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => {
                              setViewerFiles(childFiles);
                              setViewerIndex(idx);
                            }}
                            className="flex items-center gap-2.5 font-medium hover:text-[#2563EB] dark:hover:text-[#38BDF8] text-left"
                          >
                            {renderFileIcon(f.mediaKind)}
                            <span className="truncate max-w-[260px] sm:max-w-sm">{f.name}</span>
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 capitalize">
                          {f.mediaKind}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {formatBytes(f.sizeBytes)}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-slate-500 dark:text-slate-400">
                          {formatShortDate(f.updatedAt)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/files/${f.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ isFavorite: !f.isFavorite }),
                                });
                                await refreshLibrary();
                              }}
                              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Favorite"
                            >
                              <Heart className={`w-3.5 h-3.5 ${f.isFavorite ? 'text-rose-500 fill-rose-500' : 'text-slate-400'}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setShareTarget({ type: 'file', id: f.id, name: f.name, isVault: f.isVault })}
                              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#38BDF8]"
                              title="Share"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenameTarget({ kind: 'file', id: f.id, name: f.name })}
                              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                              title="Rename"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={f.downloadUrl}
                              download={f.name}
                              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/files/${f.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ isTrashed: true }),
                                });
                                await Promise.all([refreshLibrary(), refreshStorage()]);
                                pushToast({ kind: 'info', title: 'Moved to Trash' });
                              }}
                              className="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {childFiles.map((f, idx) => {
                const selected = selectedFileIds.includes(f.id);
                return (
                  <div
                    key={f.id}
                    className={`group relative rounded-xl overflow-hidden bg-white dark:bg-[#1F2937] border ${
                      selected ? 'border-[#2563EB] ring-2 ring-[#2563EB]' : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setViewerFiles(childFiles);
                        setViewerIndex(idx);
                      }}
                      className="w-full text-left"
                    >
                      <div className="aspect-[4/3] bg-slate-100 dark:bg-[#111827] flex items-center justify-center overflow-hidden">
                        {f.mediaKind === 'photo' ? (
                          <img
                            src={f.url}
                            alt={f.name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          renderFileIcon(f.mediaKind)
                        )}
                      </div>
                      <div className="p-3">
                        <div className="text-xs font-semibold truncate">{f.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {formatBytes(f.sizeBytes)} · {formatShortDate(f.updatedAt)}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedFileIds((prev) =>
                          prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]
                        )
                      }
                      className={`absolute top-2 left-2 w-6 h-6 rounded-full border flex items-center justify-center ${
                        selected
                          ? 'bg-[#2563EB] border-[#2563EB] text-white'
                          : 'bg-black/40 border-white/60 text-white opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {selected && <Check className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Shortcuts: Ctrl+C Copy</span>
            <span>Ctrl+X Cut</span>
            <span>Ctrl+V Paste</span>
            <span>Ctrl+A Select All</span>
            <span>Ctrl+U Upload</span>
            <span>Ctrl+Shift+N New Folder</span>
            <span>Delete Trash</span>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {newFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <form
            onSubmit={createFolder}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 p-5 space-y-4"
          >
            <h3 className="font-display text-base font-semibold">Create New Folder</h3>
            <input
              type="text"
              autoFocus
              required
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewFolderOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#2563EB] text-white"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <form
            onSubmit={submitRename}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 p-5 space-y-4"
          >
            <h3 className="font-display text-base font-semibold">Rename {renameTarget.kind}</h3>
            <input
              type="text"
              autoFocus
              required
              value={renameTarget.name}
              onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#2563EB] text-white"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Move Modal */}
      {moveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <h3 className="font-display text-base font-semibold">Move {selectedFileIds.length} item(s)</h3>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              <button
                type="button"
                onClick={() => setMoveDestFolderId(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium border ${
                  moveDestFolderId === null
                    ? 'border-[#2563EB] bg-[#2563EB]/10'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                My Drive (Root)
              </button>
              {folders.map((fld) => (
                <button
                  key={fld.id}
                  type="button"
                  onClick={() => setMoveDestFolderId(fld.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium border flex items-center gap-2 ${
                    moveDestFolderId === fld.id
                      ? 'border-[#2563EB] bg-[#2563EB]/10'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5 text-[#38BDF8]" />
                  {fld.name}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiFetch('/api/files/bulk', {
                    method: 'POST',
                    body: JSON.stringify({
                      action: 'move',
                      fileIds: selectedFileIds,
                      targetFolderId: moveDestFolderId,
                    }),
                  });
                  setMoveModalOpen(false);
                  setSelectedFileIds([]);
                  await refreshLibrary();
                  pushToast({ kind: 'success', title: 'Moved files' });
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#2563EB] text-white"
              >
                Move Here
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerFiles && (
        <MediaViewerModal
          items={viewerFiles}
          initialIndex={viewerIndex}
          onClose={() => setViewerFiles(null)}
        />
      )}

      {shareTarget && (
        <ShareModal
          resourceType={shareTarget.type}
          resourceId={shareTarget.id}
          resourceName={shareTarget.name}
          isVault={shareTarget.isVault}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
