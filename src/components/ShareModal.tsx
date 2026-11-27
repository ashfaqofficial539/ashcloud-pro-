import React, { useEffect, useState } from 'react';
import { Calendar, Check, Copy, Globe, Lock, Mail, Share2, X } from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';

interface ShareModalProps {
  resourceType: 'file' | 'folder' | 'album';
  resourceId: string;
  resourceName: string;
  isVault?: boolean;
  onClose: () => void;
}

export function ShareModal({
  resourceType,
  resourceId,
  resourceName,
  isVault = false,
  onClose,
}: ShareModalProps) {
  const { refreshShares, pushToast } = useAshcloud();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [permission, setPermission] = useState<'viewer' | 'commenter' | 'editor'>('viewer');
  const [isLinkPublic, setIsLinkPublic] = useState(false);
  const [allowCopy, setAllowCopy] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [directoryUsers, setDirectoryUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ users: Array<{ id: string; name: string; email: string }> }>(
      `/api/users/directory?q=${encodeURIComponent(recipientEmail)}`
    )
      .then((res) => setDirectoryUsers(res.users || []))
      .catch(() => {});
  }, [recipientEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isVault) {
      setError('Hidden Vault items cannot be shared.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ share: { shareToken: string } }>('/api/shares', {
        method: 'POST',
        body: JSON.stringify({
          resourceType,
          resourceId,
          recipientEmail: recipientEmail.trim() || null,
          permission,
          allowCopy,
          isLinkPublic,
          password: password.trim() || null,
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        }),
      });
      await refreshShares();
      const shareUrl = `${window.location.origin}/s/${res.share.shareToken}`;
      setCreatedShareUrl(shareUrl);
      pushToast({
        kind: 'success',
        title: 'Share created',
        description: recipientEmail
          ? `Invitation sent to ${recipientEmail}`
          : 'Shareable link generated',
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to create share.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!createdShareUrl) return;
    try {
      await navigator.clipboard.writeText(createdShareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast({ kind: 'error', title: 'Clipboard blocked', description: 'Copy the link manually from the box.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold truncate">Share “{resourceName}”</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{resourceType} permissions & link settings</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {isVault && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-500">
              Hidden Vault items are isolated and cannot be shared. Move the item out of Vault first if you wish to share it.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Invite by Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="collaborator@ashcloud.io"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            {directoryUsers.length > 0 && !createdShareUrl && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {directoryUsers.slice(0, 3).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setRecipientEmail(u.email)}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-700 hover:border-[#2563EB] transition-colors"
                  >
                    {u.name} ({u.email})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Permission Level
              </label>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as any)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#2563EB]"
              >
                <option value="viewer">Viewer (Open & Download)</option>
                <option value="commenter">Commenter (View & Comment)</option>
                <option value="editor">Editor (Rename & Organize)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Expiry Date (Optional)
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  value={expiresAt}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-[#38BDF8]" />
                <div>
                  <div className="text-xs font-semibold">Anyone with the link</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Generate an unguessable public share URL
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isLinkPublic}
                onChange={(e) => setIsLinkPublic(e.target.checked)}
                className="w-4 h-4 accent-[#2563EB]"
              />
            </label>

            {isLinkPublic && (
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Optional Link Password
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Leave blank for no password"
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>
            )}

            <label className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 cursor-pointer">
              <div>
                <div className="text-xs font-semibold">Allow recipients to save independent copies</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  When disabled, recipients can view or save a linked reference only
                </div>
              </div>
              <input
                type="checkbox"
                checked={allowCopy}
                onChange={(e) => setAllowCopy(e.target.checked)}
                className="w-4 h-4 accent-[#2563EB]"
              />
            </label>
          </div>

          {createdShareUrl && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-2">
              <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Share link ready
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdShareUrl}
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-semibold whitespace-nowrap"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-500">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={submitting || isVault}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
            >
              <Share2 className="w-3.5 h-3.5" />
              {submitting ? 'Sharing...' : 'Create Share'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
