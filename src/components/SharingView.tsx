import React, { useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  Share2,
  ShieldOff,
  Users,
  X,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';
import { formatBytes, formatShortDate } from '../lib/format';
import type { CloudFile } from '../types';
import { MediaViewerModal } from './MediaViewerModal';
import { SaveToMyPhotosModal } from './SaveToMyPhotosModal';

export function SharingView({ mode }: { mode: 'with-me' | 'by-me' }) {
  const { sharesWithMe, sharesByMe, refreshShares, pushToast } = useAshcloud();
  const [viewerItems, setViewerItems] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saveTarget, setSaveTarget] = useState<{
    file: CloudFile;
    shareId: string;
    ownerName: string;
    permission: string;
    allowCopy: boolean;
  } | null>(null);

  const pendingShares = sharesWithMe.filter((s) => s.status === 'pending');
  const acceptedShares = sharesWithMe.filter((s) => s.status === 'accepted');

  const respondInvite = async (shareId: string, decision: 'accept' | 'reject') => {
    await apiFetch(`/api/shares/${shareId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    await refreshShares();
    pushToast({
      kind: decision === 'accept' ? 'success' : 'info',
      title: decision === 'accept' ? 'Invitation accepted' : 'Invitation declined',
    });
  };

  const revokeShare = async (shareId: string) => {
    await apiFetch(`/api/shares/${shareId}/revoke`, { method: 'POST' });
    await refreshShares();
    pushToast({ kind: 'info', title: 'Access revoked' });
  };

  const updatePermission = async (shareId: string, permission: string) => {
    await apiFetch(`/api/shares/${shareId}`, {
      method: 'PATCH',
      body: JSON.stringify({ permission }),
    });
    await refreshShares();
    pushToast({ kind: 'success', title: 'Permission updated' });
  };

  const resendInvite = async (shareId: string) => {
    await apiFetch(`/api/shares/${shareId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resend: true }),
    });
    pushToast({ kind: 'success', title: 'Invitation notification resent' });
  };

  const copyShareUrl = async (shareId: string, token: string) => {
    const url = `${window.location.origin}/s/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(shareId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      pushToast({ kind: 'error', title: 'Clipboard blocked', description: url });
    }
  };

  if (mode === 'with-me') {
    return (
      <div className="space-y-6">
        {pendingShares.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display text-sm font-semibold text-[#2563EB] dark:text-[#38BDF8]">
              Pending Invitations ({pendingShares.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingShares.map((inv) => {
                const name = inv.file?.name || inv.folder?.name || inv.album?.title || 'Shared item';
                return (
                  <div
                    key={inv.shareId}
                    className="p-4 rounded-xl bg-white dark:bg-[#1F2937] border border-[#2563EB]/40 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        From {inv.ownerName} ({inv.ownerEmail}) · {inv.permission}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                        Shared {formatShortDate(inv.sharedAt)}
                        {inv.expiresAt ? ` · Expires ${formatShortDate(inv.expiresAt)}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => respondInvite(inv.shareId, 'accept')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold"
                      >
                        <Check className="w-3.5 h-3.5" /> Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => respondInvite(inv.shareId, 'reject')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <X className="w-3.5 h-3.5" /> Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">Shared With Me</h2>
            <span className="text-xs text-slate-400 tabular-nums">{acceptedShares.length} active</span>
          </div>

          {acceptedShares.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center space-y-2">
              <Users className="w-9 h-9 text-[#38BDF8] mx-auto" />
              <div className="text-sm font-semibold">Nothing shared with you yet</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                When other ASHCLOUD users share files, photos, folders, or albums with you and you accept, they appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {acceptedShares.map((s) => {
                if (s.file) {
                  const f = s.file;
                  return (
                    <div
                      key={s.shareId}
                      className="rounded-xl overflow-hidden bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 flex flex-col"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setViewerItems([f]);
                          setViewerIndex(0);
                        }}
                        className="aspect-[16/10] bg-slate-100 dark:bg-[#111827] flex items-center justify-center overflow-hidden"
                      >
                        {f.mediaKind === 'photo' ? (
                          <img
                            src={f.url}
                            alt={f.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileText className="w-8 h-8 text-[#38BDF8]" />
                        )}
                      </button>
                      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold truncate">{f.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {s.ownerName} · <span className="capitalize">{s.permission}</span> · {formatBytes(f.sizeBytes)}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                            Shared {formatShortDate(s.sharedAt)}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setViewerItems([f]);
                              setViewerIndex(0);
                            }}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
                          >
                            Open
                          </button>
                          {(f.mediaKind === 'photo' || f.mediaKind === 'video') && (
                            <button
                              type="button"
                              onClick={() =>
                                setSaveTarget({
                                  file: f,
                                  shareId: s.shareId,
                                  ownerName: s.ownerName,
                                  permission: s.permission,
                                  allowCopy: s.allowCopy !== false,
                                })
                              }
                              className="inline-flex items-center gap-1 py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#2563EB] text-xs font-semibold"
                              title="Save to My Photos"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5 text-[#38BDF8]" />
                              Save
                            </button>
                          )}
                          <a
                            href={f.downloadUrl}
                            download={f.name}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                }

                const containerFiles = s.folder?.files || s.album?.files || [];
                const title = s.folder?.name || s.album?.title || 'Shared Collection';
                return (
                  <div
                    key={s.shareId}
                    className="p-4 rounded-xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {s.resourceType === 'album' ? (
                          <Layers className="w-5 h-5 text-[#38BDF8] shrink-0" />
                        ) : (
                          <Folder className="w-5 h-5 text-[#38BDF8] shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{title}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {s.ownerName} · {s.permission} · {containerFiles.length} item(s)
                          </div>
                        </div>
                      </div>
                    </div>
                    {containerFiles.length > 0 && (
                      <div className="space-y-1.5 max-h-44 overflow-y-auto pt-2 border-t border-slate-100 dark:border-slate-800">
                        {containerFiles.map((cf, idx) => (
                          <div
                            key={cf.id}
                            className="w-full flex items-center justify-between gap-2 text-xs py-1 px-2 rounded hover:bg-slate-50 dark:hover:bg-[#0B0E14]"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setViewerItems(containerFiles);
                                setViewerIndex(idx);
                              }}
                              className="flex items-center gap-2 truncate text-left flex-1 min-w-0"
                            >
                              {cf.mediaKind === 'photo' ? (
                                <ImageIcon className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                              ) : (
                                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              <span className="truncate">{cf.name}</span>
                            </button>
                            <div className="flex items-center gap-2 shrink-0">
                              {(cf.mediaKind === 'photo' || cf.mediaKind === 'video') && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSaveTarget({
                                      file: cf,
                                      shareId: s.shareId,
                                      ownerName: s.ownerName,
                                      permission: s.permission,
                                      allowCopy: s.allowCopy !== false,
                                    })
                                  }
                                  className="text-[11px] font-semibold text-[#2563EB] dark:text-[#38BDF8] hover:underline"
                                >
                                  Save
                                </button>
                              )}
                              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                                {formatBytes(cf.sizeBytes)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {viewerItems && (
          <MediaViewerModal
            items={viewerItems}
            initialIndex={viewerIndex}
            onClose={() => setViewerItems(null)}
            readOnly
            shareContextByFileId={Object.fromEntries(
              acceptedShares.flatMap((s) => {
                const info = {
                  shareId: s.shareId,
                  ownerName: s.ownerName,
                  permission: s.permission,
                  allowCopy: s.allowCopy !== false,
                };
                const list: Array<[string, typeof info]> = [];
                if (s.file) list.push([s.file.id, info]);
                for (const af of s.album?.files || []) list.push([af.id, info]);
                for (const ff of s.folder?.files || []) list.push([ff.id, info]);
                return list;
              })
            )}
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

  // mode === 'by-me'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold">Shared By Me</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Manage invitations, public links, permissions, expiry dates, and access revocation.
          </p>
        </div>
        <span className="text-xs text-slate-400 tabular-nums">{sharesByMe.length} record(s)</span>
      </div>

      {sharesByMe.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Share2 className="w-9 h-9 text-[#38BDF8] mx-auto" />
          <div className="text-sm font-semibold">You haven't shared anything yet</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Use the Share button on any photo, file, folder, or album to invite collaborators or generate links.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Item</th>
                <th className="py-3 px-3">Recipient / Link</th>
                <th className="py-3 px-3">Permission</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Expires</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {sharesByMe.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-[#111827]/60">
                  <td className="py-3 px-4">
                    <div className="font-semibold truncate max-w-[200px]">{s.resourceName}</div>
                    <div className="text-[11px] text-slate-400 capitalize">{s.resourceType}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div>{s.recipientEmail || (s.isLinkPublic ? 'Anyone with link' : '—')}</div>
                    {s.hasPassword && <div className="text-[11px] text-amber-500">Password protected</div>}
                  </td>
                  <td className="py-3 px-3">
                    <select
                      disabled={s.status === 'revoked'}
                      value={s.permission}
                      onChange={(e) => updatePermission(s.id, e.target.value)}
                      className="px-2 py-1 text-xs rounded bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="commenter">Commenter</option>
                      <option value="editor">Editor</option>
                    </select>
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`font-medium capitalize ${
                        s.status === 'accepted'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : s.status === 'pending'
                          ? 'text-[#2563EB] dark:text-[#38BDF8]'
                          : 'text-red-500'
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 tabular-nums text-slate-500 dark:text-slate-400">
                    {s.expiresAt ? formatShortDate(s.expiresAt) : 'Never'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      {s.isLinkPublic && s.status !== 'revoked' && (
                        <>
                          <button
                            type="button"
                            onClick={() => copyShareUrl(s.id, s.shareToken)}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[#2563EB] dark:text-[#38BDF8]"
                            title="Copy share link"
                          >
                            {copiedId === s.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <a
                            href={`/s/${s.shareToken}`}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                            title="Open share link"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </>
                      )}
                      {s.status === 'pending' && s.recipientEmail && (
                        <button
                          type="button"
                          onClick={() => resendInvite(s.id)}
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#38BDF8]"
                          title="Resend invitation"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {s.status !== 'revoked' && (
                        <button
                          type="button"
                          onClick={() => revokeShare(s.id)}
                          className="p-1.5 rounded hover:bg-red-500/10 text-red-500"
                          title="Revoke access"
                        >
                          <ShieldOff className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
