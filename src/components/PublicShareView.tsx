import React, { useEffect, useState } from 'react';
import { Download, FileText, Lock, ShieldAlert } from 'lucide-react';
import { formatBytes, formatShortDate } from '../lib/format';
import type { CloudFile } from '../types';
import { BrandLogo } from './BrandLogo';

interface PublicPayload {
  requiresPassword?: boolean;
  resourceType?: 'file' | 'folder' | 'album';
  ownerName?: string;
  permission?: string;
  expiresAt?: string | null;
  file?: CloudFile;
  folder?: { id: string; name: string; files: CloudFile[] };
  album?: { id: string; title: string; description: string; files: CloudFile[] };
}

export function PublicShareView({ token }: { token: string }) {
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Share link unavailable');
        setPayload(data);
      })
      .catch((err) => setError(err?.message || 'Unable to load shared item.'))
      .finally(() => setLoading(false));
  }, [token]);

  const verifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/public/share/${encodeURIComponent(token)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Incorrect password');
      return;
    }
    setPayload(data);
  };

  return (
    <div className="min-h-screen bg-[#111827] text-[#F8FAFC] flex flex-col">
      <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <a href="/">
          <BrandLogo />
        </a>
        <a
          href="/"
          className="px-3.5 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
        >
          Open ASHCLOUD
        </a>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        {loading ? (
          <div className="text-sm text-slate-400">Verifying share link...</div>
        ) : error && !payload?.requiresPassword ? (
          <div className="max-w-md w-full p-8 rounded-2xl bg-[#1F2937] border border-slate-800 text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-red-400 mx-auto" />
            <h1 className="font-display text-lg font-semibold">Link Unavailable</h1>
            <p className="text-xs text-slate-400">{error}</p>
          </div>
        ) : payload?.requiresPassword ? (
          <form
            onSubmit={verifyPassword}
            className="max-w-sm w-full p-6 rounded-2xl bg-[#1F2937] border border-slate-800 space-y-4"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="w-4 h-4 text-[#38BDF8]" />
              Password Protected Share
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter share password"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#111827] border border-slate-700"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
            >
              Unlock Shared Item
            </button>
          </form>
        ) : payload?.file ? (
          <div className="max-w-3xl w-full rounded-2xl bg-[#1F2937] border border-slate-800 overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-base font-semibold">{payload.file.name}</h1>
                <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                  Shared by {payload.ownerName} · {formatBytes(payload.file.sizeBytes)}
                  {payload.expiresAt ? ` · Expires ${formatShortDate(payload.expiresAt)}` : ''}
                </p>
              </div>
              <a
                href={payload.file.downloadUrl}
                download={payload.file.name}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
              >
                <Download className="w-4 h-4" />
                Download
              </a>
            </div>
            <div className="p-6 bg-[#0B0F19] flex items-center justify-center min-h-[360px]">
              {payload.file.mediaKind === 'photo' ? (
                <img
                  src={payload.file.url}
                  alt={payload.file.name}
                  referrerPolicy="no-referrer"
                  className="max-h-[70vh] rounded-lg object-contain"
                />
              ) : payload.file.mediaKind === 'video' ? (
                <video src={payload.file.url} controls className="max-h-[70vh] rounded-lg" />
              ) : (
                <div className="text-center space-y-2">
                  <FileText className="w-10 h-10 text-[#38BDF8] mx-auto" />
                  <p className="text-xs text-slate-400">Download this file to view its full contents.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl w-full rounded-2xl bg-[#1F2937] border border-slate-800 p-6 space-y-4">
            <div>
              <h1 className="font-display text-lg font-semibold">
                {payload?.folder?.name || payload?.album?.title}
              </h1>
              <p className="text-xs text-slate-400">Shared by {payload?.ownerName}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(payload?.folder?.files || payload?.album?.files || []).map((f) => (
                <div key={f.id} className="rounded-xl bg-[#111827] border border-slate-800 overflow-hidden">
                  <div className="aspect-[4/3] bg-black/40 flex items-center justify-center">
                    {f.mediaKind === 'photo' ? (
                      <img src={f.url} alt={f.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    ) : (
                      <FileText className="w-8 h-8 text-[#38BDF8]" />
                    )}
                  </div>
                  <div className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{f.name}</div>
                      <div className="text-[11px] text-slate-400 tabular-nums">{formatBytes(f.sizeBytes)}</div>
                    </div>
                    <a
                      href={f.downloadUrl}
                      download={f.name}
                      className="p-1.5 rounded-lg bg-[#2563EB] text-white shrink-0"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
