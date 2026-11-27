import React, { useState } from 'react';
import { Copy, Film, HardDrive, Link2, Loader2, ShieldAlert, X } from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';
import type { CloudFile } from '../types';

interface SaveToMyPhotosModalProps {
  file: CloudFile;
  shareId: string;
  ownerName: string;
  permission?: string;
  allowCopy?: boolean;
  onClose: () => void;
  onSaved?: (mode: 'reference' | 'copy') => void;
}

export function SaveToMyPhotosModal({
  file,
  shareId,
  ownerName,
  permission = 'viewer',
  allowCopy = true,
  onClose,
  onSaved,
}: SaveToMyPhotosModalProps) {
  const { refreshLibrary, refreshStorage, refreshShares, pushToast } = useAshcloud();
  const [mode, setMode] = useState<'reference' | 'copy'>(allowCopy ? 'copy' : 'reference');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/shares/save-to-photos', {
        method: 'POST',
        body: JSON.stringify({
          shareId,
          fileId: file.id,
          mode,
        }),
      });
      await Promise.all([refreshLibrary(), refreshStorage(), refreshShares()]);
      pushToast({
        kind: 'success',
        title: mode === 'copy' ? 'Saved independent copy to My Photos' : 'Saved shared reference to My Photos',
        description: file.name,
      });
      onSaved?.(mode);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to save to My Photos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-[#232B3B] flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold">Save to My Photos</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Shared by {ownerName} · <span className="capitalize">{permission}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Preview strip */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B]">
            <div className="w-12 h-12 rounded-lg bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
              {file.mediaKind === 'video' ? (
                <Film className="w-5 h-5 text-[#38BDF8]" />
              ) : (
                <img
                  src={file.url}
                  alt={file.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate">{file.name}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                {formatBytes(file.sizeBytes)}
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => setMode('reference')}
              className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                mode === 'reference'
                  ? 'border-[#2563EB] bg-[#2563EB]/10'
                  : 'border-slate-200 dark:border-[#232B3B] hover:border-slate-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Link2 className="w-4 h-4 text-[#38BDF8]" />
                  Save as Shared Reference
                </div>
                <span className="font-mono text-[11px] text-emerald-500 font-semibold">0 B used</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                Adds this item to your My Photos timeline without duplicating storage. If {ownerName} revokes access or deletes the original, this reference is removed automatically.
              </p>
            </button>

            <button
              type="button"
              disabled={!allowCopy}
              onClick={() => allowCopy && setMode('copy')}
              className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                !allowCopy
                  ? 'border-slate-200 dark:border-[#232B3B] opacity-55 cursor-not-allowed'
                  : mode === 'copy'
                  ? 'border-[#2563EB] bg-[#2563EB]/10'
                  : 'border-slate-200 dark:border-[#232B3B] hover:border-slate-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Copy className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8]" />
                  Save as Independent Copy
                </div>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums inline-flex items-center gap-1">
                  <HardDrive className="w-3 h-3" /> +{formatBytes(file.sizeBytes)}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                {allowCopy
                  ? `Creates a permanent copy owned by your account (${formatBytes(file.sizeBytes)} counted in your storage). Stays in your library even if the owner deletes or unshares the original.`
                  : 'Copy/download permission is disabled by the owner for this share.'}
              </p>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-500 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#232B3B] text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-60"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Saving...' : 'Save to My Photos'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
