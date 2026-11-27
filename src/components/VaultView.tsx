import React, { useRef, useState } from 'react';
import {
  ArrowUpRight,
  Download,
  FileText,
  Folder,
  FolderPlus,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';
import { formatBytes, formatShortDate } from '../lib/format';
import type { CloudFile } from '../types';
import { MediaViewerModal } from './MediaViewerModal';

export function VaultView() {
  const {
    user,
    vaultUnlocked,
    vaultExpiresAt,
    vaultFiles,
    vaultFolders,
    setupVaultPin,
    unlockVault,
    lockVault,
    refreshVaultItems,
    refreshLibrary,
    refreshStorage,
    enqueueUploads,
    pushToast,
  } = useAshcloud();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [viewerItems, setViewerItems] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,8}$/.test(pin)) {
      setError('PIN must be 4 to 8 digits.');
      return;
    }
    if (!user?.hasVaultPin && pin !== confirmPin) {
      setError('PIN confirmation does not match.');
      return;
    }
    setSubmitting(true);
    try {
      if (user?.hasVaultPin) {
        await unlockVault(pin);
      } else {
        await setupVaultPin(pin);
      }
      setPin('');
      setConfirmPin('');
    } catch (err: any) {
      setError(err?.message || 'Unable to verify Vault PIN.');
    } finally {
      setSubmitting(false);
    }
  };

  const moveOutOfVault = async (fileId: string) => {
    await apiFetch(`/api/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isVault: false }),
    });
    await Promise.all([refreshVaultItems(), refreshLibrary(), refreshStorage()]);
    pushToast({ kind: 'success', title: 'Moved back to main library' });
  };

  const createVaultFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await apiFetch('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name: newFolderName.trim(), isVault: true }),
    });
    setNewFolderName('');
    await refreshVaultItems();
  };

  if (!vaultUnlocked) {
    return (
      <div className="min-h-[65vh] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-5">
          <div className="w-12 h-12 rounded-xl bg-[#2563EB]/10 text-[#2563EB] dark:text-[#38BDF8] flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-xl font-bold">
              {user?.hasVaultPin ? 'Unlock Hidden Vault' : 'Set Up Hidden Vault PIN'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {user?.hasVaultPin
                ? 'Vault items are excluded from global search, sharing, and ordinary galleries. Enter your 4–8 digit PIN.'
                : 'Create a 4–8 digit PIN to isolate sensitive photos, videos, and documents on the backend.'}
            </p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Vault PIN (4–8 digits)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,8}"
                  maxLength={8}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full pl-10 pr-4 py-2.5 text-sm font-mono tracking-widest rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>

            {!user?.hasVaultPin && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Confirm PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,8}"
                  maxLength={8}
                  required
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full px-4 py-2.5 text-sm font-mono tracking-widest rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
                />
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-500">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
            >
              {submitting ? 'Verifying...' : user?.hasVaultPin ? 'Unlock Hidden Vault' : 'Enable & Open Vault'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Vault Header */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <Unlock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-base font-semibold flex items-center gap-2">
              Hidden Vault Unlocked
              <ShieldCheck className="w-4 h-4 text-[#38BDF8]" />
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Isolated from Global Search & Sharing · Auto-locks at{' '}
              {vaultExpiresAt ? new Date(vaultExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'timeout'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (!e.target.files || e.target.files.length === 0) return;
              enqueueUploads(
                Array.from(e.target.files).map((file) => ({ file })),
                { destinationLabel: 'Hidden Vault', folderId: null, isVault: true }
              );
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Private File
          </button>
          <button
            type="button"
            onClick={lockVault}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Lock className="w-3.5 h-3.5" />
            Lock Now
          </button>
        </div>
      </div>

      {/* Create Private Folder */}
      <form onSubmit={createVaultFolder} className="flex items-center gap-2 max-w-md">
        <input
          type="text"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder="New private Vault folder..."
          className="flex-1 px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1F2937] text-xs font-semibold hover:border-[#2563EB]"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[#38BDF8]" />
          Add Folder
        </button>
      </form>

      {vaultFolders.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {vaultFolders.map((fld) => (
            <div
              key={fld.id}
              className="p-3.5 rounded-xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Folder className="w-4 h-4 text-[#38BDF8] shrink-0" />
                <span className="text-xs font-semibold truncate">{fld.name}</span>
              </div>
              <span className="text-[11px] text-slate-400">Private</span>
            </div>
          ))}
        </div>
      )}

      {vaultFiles.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Lock className="w-9 h-9 text-[#38BDF8] mx-auto" />
          <div className="text-sm font-semibold">Hidden Vault is empty</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Upload private files directly here or move existing items from Photos or Drive into your Vault.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {vaultFiles.map((f, idx) => (
            <div
              key={f.id}
              className="rounded-xl overflow-hidden bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 flex flex-col"
            >
              <button
                type="button"
                onClick={() => {
                  setViewerItems(vaultFiles);
                  setViewerIndex(idx);
                }}
                className="aspect-[4/3] bg-slate-100 dark:bg-[#111827] flex items-center justify-center overflow-hidden"
              >
                {f.mediaKind === 'photo' ? (
                  <img src={f.url} alt={f.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  <FileText className="w-8 h-8 text-[#38BDF8]" />
                )}
              </button>
              <div className="p-3.5 space-y-3">
                <div>
                  <div className="text-xs font-semibold truncate">{f.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                    {formatBytes(f.sizeBytes)} · {formatShortDate(f.createdAt)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => moveOutOfVault(f.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] dark:text-[#38BDF8] hover:underline"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Move out
                  </button>
                  <div className="flex items-center gap-1">
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
                        await Promise.all([refreshVaultItems(), refreshStorage()]);
                        pushToast({ kind: 'info', title: 'Moved to Trash' });
                      }}
                      className="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500"
                      title="Move to Trash"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewerItems && (
        <MediaViewerModal
          items={viewerItems}
          initialIndex={viewerIndex}
          onClose={() => setViewerItems(null)}
        />
      )}
    </div>
  );
}
