import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  Clock,
  FileText,
  Folder,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Share2,
  Upload,
  Users,
  Video,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { formatBytes, formatRelativeTime } from '../lib/format';
import type { CloudFile } from '../types';
import { MediaViewerModal } from './MediaViewerModal';

export function HomeDashboard() {
  const {
    user,
    files,
    sharesWithMe,
    storageSummary,
    activity,
    setActiveNav,
    enqueueUploads,
  } = useAshcloud();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewerFiles, setViewerFiles] = useState<CloudFile[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const usedBytes = storageSummary?.userUsedBytes ?? 0;
  const targetBytes = storageSummary?.targetCapacityBytes ?? 512 * 1000 ** 4;
  const provisionedBytes = storageSummary?.provisionedCapacityBytes ?? 0;
  const provisionedAvailable = storageSummary?.provisionedAvailableBytes ?? 0;
  const targetPct = targetBytes > 0 ? (usedBytes / targetBytes) * 100 : 0;

  const recentUploads = files.slice(0, 6);
  const recentlyOpened = [...files]
    .filter((f) => f.lastOpenedAt)
    .sort((a, b) => new Date(b.lastOpenedAt!).getTime() - new Date(a.lastOpenedAt!).getTime())
    .slice(0, 4);
  const favoriteItems = files.filter((f) => f.isFavorite).slice(0, 4);
  const acceptedShares = sharesWithMe.filter((s) => s.status === 'accepted').slice(0, 4);

  const trend = storageSummary?.uploadHistory || [];
  const maxTrend = Math.max(1, ...trend.map((t) => t.bytes));

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    enqueueUploads(
      Array.from(fileList).map((file) => ({ file })),
      { destinationLabel: 'My Cloud', folderId: null, isVault: false }
    );
  };

  return (
    <div className="space-y-6">
      {/* Hero Greeting + Quick Upload */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-[#2563EB] dark:text-[#38BDF8]">
                ASHCLOUD · One Cloud. Every File. Every Memory.
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-balance">
                Welcome back, {user?.name?.split(' ')[0]}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Real-time storage telemetry across your Photos, Drive, Albums, and Hidden Vault.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveNav('storage')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <HardDrive className="w-3.5 h-3.5 text-[#38BDF8]" />
              Storage Console
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-[#38BDF8]" />
                Photos
              </div>
              <div className="font-mono text-xl font-semibold tabular-nums mt-1">
                {storageSummary?.counts.photos ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-[#2563EB]" />
                Videos
              </div>
              <div className="font-mono text-xl font-semibold tabular-nums mt-1">
                {storageSummary?.counts.videos ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-500" />
                Total Files
              </div>
              <div className="font-mono text-xl font-semibold tabular-nums mt-1">
                {storageSummary?.counts.files ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-amber-500" />
                Folders
              </div>
              <div className="font-mono text-xl font-semibold tabular-nums mt-1">
                {storageSummary?.counts.folders ?? 0}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Upload Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFilesSelected(e.dataTransfer.files);
          }}
          className={`lg:col-span-5 p-6 rounded-2xl border-2 border-dashed transition-colors flex flex-col items-center justify-center text-center gap-3 ${
            dragOver
              ? 'border-[#2563EB] bg-[#2563EB]/10'
              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1F2937]'
          }`}
        >
          <div className="w-11 h-11 rounded-xl bg-[#2563EB]/10 text-[#2563EB] dark:text-[#38BDF8] flex items-center justify-center">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Quick Cloud Upload</div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Drag photos, videos, or documents here to upload directly.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Select Files from Device
          </button>
        </div>
      </section>

      {/* Storage Capacity + 7-Day Upload Analytics */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-5 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">512 TB Storage Architecture</h2>
            <span className="font-mono text-xs text-[#2563EB] dark:text-[#38BDF8] tabular-nums">
              {targetPct.toFixed(6)}% of target
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Actual Used</div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-0.5">
                {formatBytes(usedBytes, 2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Target Capacity</div>
              <div className="font-mono text-2xl font-bold tabular-nums mt-0.5">512 TB</div>
            </div>
          </div>

          <div className="h-2 rounded-full bg-slate-100 dark:bg-[#111827] overflow-hidden">
            <div
              className="h-full bg-[#2563EB] rounded-full"
              style={{ width: `${Math.max(usedBytes > 0 ? 2 : 0, Math.min(100, targetPct))}%` }}
            />
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Provisioned Node Disk</span>
              <span className="font-mono tabular-nums">{formatBytes(provisionedBytes)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Available on Node</span>
              <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatBytes(provisionedAvailable)}
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-display text-base font-semibold">7-Day Upload Volume</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Measured bytes ingested into private storage
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {formatBytes(trend.reduce((acc, t) => acc + t.bytes, 0))} total
            </span>
          </div>

          <div className="h-36 flex items-end gap-3 pt-4">
            {trend.map((day) => {
              const heightPct = day.bytes > 0 ? Math.max(12, Math.round((day.bytes / maxTrend) * 100)) : 4;
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                    {day.bytes > 0 ? formatBytes(day.bytes, 0) : '0'}
                  </div>
                  <div className="w-full max-w-[36px] flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-md transition-all ${
                        day.bytes > 0 ? 'bg-[#2563EB]' : 'bg-slate-200 dark:bg-slate-800'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{day.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Recent Uploads + Favorites + Shared + Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">Recent Uploads</h2>
            <button
              type="button"
              onClick={() => setActiveNav('photos')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] dark:text-[#38BDF8] hover:underline"
            >
              Open Photos
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentUploads.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No uploads yet. Drop files above to start building your library.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {recentUploads.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setViewerFiles(recentUploads);
                    setViewerIndex(idx);
                  }}
                  className="group text-left rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#111827] hover:border-[#2563EB] transition-colors"
                >
                  <div className="aspect-[4/3] bg-slate-200 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                    {item.mediaKind === 'photo' ? (
                      <img
                        src={item.url}
                        alt={item.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                      />
                    ) : (
                      <FileText className="w-8 h-8 text-[#38BDF8]" />
                    )}
                  </div>
                  <div className="p-2.5">
                    <div className="text-xs font-medium truncate">{item.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5 tabular-nums">
                      <span>{formatBytes(item.sizeBytes)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRelativeTime(item.createdAt)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 space-y-5">
          {/* Quick Lists */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#38BDF8]" />
                Recently Opened & Favorites
              </h2>
              <button
                type="button"
                onClick={() => setActiveNav('favorites')}
                className="text-xs text-[#2563EB] dark:text-[#38BDF8] hover:underline"
              >
                All
              </button>
            </div>
            <div className="space-y-2">
              {(recentlyOpened.length > 0 ? recentlyOpened : favoriteItems).slice(0, 4).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setViewerFiles([f]);
                    setViewerIndex(0);
                  }}
                  className="w-full flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-[#111827] text-left transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {f.isFavorite ? (
                      <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span className="text-xs font-medium truncate">{f.name}</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                    {formatBytes(f.sizeBytes)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Shared With Me Preview */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold flex items-center gap-2">
                <Users className="w-4 h-4 text-[#2563EB]" />
                Shared With Me
              </h2>
              <button
                type="button"
                onClick={() => setActiveNav('shared-with-me')}
                className="text-xs text-[#2563EB] dark:text-[#38BDF8] hover:underline"
              >
                View
              </button>
            </div>
            {acceptedShares.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No active shared items.</p>
            ) : (
              <div className="space-y-2">
                {acceptedShares.map((s) => (
                  <div
                    key={s.shareId}
                    className="flex items-center justify-between gap-2 text-xs py-1"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {s.file?.name || s.folder?.name || s.album?.title}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {s.ownerName} · {s.permission}
                      </div>
                    </div>
                    <Share2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Log */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-3">
            <h2 className="font-display text-sm font-semibold">Recent Activity</h2>
            <div className="space-y-2.5">
              {activity.slice(0, 4).map((act) => (
                <div key={act.id} className="text-xs flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium capitalize">{act.action.replace('_', ' ')}</span>{' '}
                    <span className="text-slate-500 dark:text-slate-300 truncate">{act.targetName}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                    {formatRelativeTime(act.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {viewerFiles && (
        <MediaViewerModal
          items={viewerFiles}
          initialIndex={viewerIndex}
          onClose={() => setViewerFiles(null)}
        />
      )}
    </div>
  );
}
