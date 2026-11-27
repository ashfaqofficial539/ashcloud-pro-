import React from 'react';
import {
  AlertTriangle,
  Database,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Lock,
  Server,
  Trash2,
  Video,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';
import { formatBytes, formatShortDate } from '../lib/format';

export function StorageView() {
  const { storageSummary, refreshLibrary, refreshStorage, setActiveNav, pushToast } = useAshcloud();

  if (!storageSummary) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
        Loading real-time storage telemetry...
      </div>
    );
  }

  const {
    targetCapacityTb,
    targetCapacityBytes,
    provisionedCapacityBytes,
    provisionedAvailableBytes,
    platformUsedBytes,
    userUsedBytes,
    breakdown,
    largeFiles,
    architecture,
  } = storageSummary;

  const targetPct = targetCapacityBytes > 0 ? (platformUsedBytes / targetCapacityBytes) * 100 : 0;
  const nodeUsedBytes = Math.max(0, provisionedCapacityBytes - provisionedAvailableBytes);
  const nodePct = provisionedCapacityBytes > 0 ? (nodeUsedBytes / provisionedCapacityBytes) * 100 : 0;

  const categories = [
    { label: 'Photos', bytes: breakdown.photosBytes, color: 'bg-[#38BDF8]', icon: ImageIcon },
    { label: 'Videos', bytes: breakdown.videosBytes, color: 'bg-[#2563EB]', icon: Video },
    { label: 'Drive Documents & Files', bytes: breakdown.driveBytes, color: 'bg-emerald-500', icon: FileText },
    { label: 'Hidden Vault', bytes: breakdown.vaultBytes, color: 'bg-amber-500', icon: Lock },
    { label: 'Trash (Reclaimable)', bytes: breakdown.trashedBytes, color: 'bg-slate-400', icon: Trash2 },
  ];

  const maxCat = Math.max(1, ...categories.map((c) => c.bytes));

  return (
    <div className="space-y-6">
      {/* Top 512 TB Architecture + Real Node Disk */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[#2563EB] dark:text-[#38BDF8]">
                ASHCLOUD Capacity Architecture ({storageSummary.unitSystem === 'decimal_TB' ? 'Decimal TB' : 'Binary TiB'})
              </p>
              <h1 className="font-display text-2xl font-bold mt-1 tabular-nums">
                Target Capacity: {targetCapacityTb} TB
              </h1>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">Your Account Used</div>
              <div className="font-mono text-xl font-bold tabular-nums text-[#2563EB] dark:text-[#38BDF8]">
                {formatBytes(userUsedBytes, 2)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs tabular-nums">
              <span className="text-slate-500 dark:text-slate-400">
                Platform Deduplicated Usage: {formatBytes(platformUsedBytes, 2)} ({platformUsedBytes.toLocaleString()} bytes)
              </span>
              <span className="font-mono">{targetPct.toFixed(6)}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 dark:bg-[#111827] overflow-hidden">
              <div
                className="h-full bg-[#2563EB] rounded-full"
                style={{ width: `${Math.max(platformUsedBytes > 0 ? 1.5 : 0, Math.min(100, targetPct))}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <div className="text-slate-500 dark:text-slate-400">Remaining to 512 TB Target</div>
              <div className="font-mono font-semibold tabular-nums mt-0.5">
                {formatBytes(Math.max(0, targetCapacityBytes - platformUsedBytes), 2)}
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">Provisioned Disk Total</div>
              <div className="font-mono font-semibold tabular-nums mt-0.5">
                {formatBytes(provisionedCapacityBytes)}
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">Provisioned Disk Free</div>
              <div className="font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                {formatBytes(provisionedAvailableBytes)}
              </div>
            </div>
          </div>

          {!architecture.targetProvisionedOnCurrentNode && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-amber-600 dark:text-amber-400">
                  512 TB is the target platform architecture — current node disk is {formatBytes(provisionedCapacityBytes)}
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  ASHCLOUD enforces real backend disk limits ({formatBytes(provisionedAvailableBytes)} available right now) and prevents uploads if node space runs out. Attach a scalable S3, Cloudflare R2, or GCS object store to provision the full 512 TB target pool.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="lg:col-span-5 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-4">
          <h2 className="font-display text-base font-semibold flex items-center gap-2">
            <Database className="w-4 h-4 text-[#38BDF8]" />
            Storage Breakdown by Category
          </h2>
          <div className="space-y-4">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const pct = cat.bytes > 0 ? Math.max(4, Math.round((cat.bytes / maxCat) * 100)) : 0;
              return (
                <div key={cat.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="w-3.5 h-3.5 text-slate-400" />
                      {cat.label}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-300">
                      {formatBytes(cat.bytes, 2)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-[#111827] overflow-hidden">
                    <div className={`h-full rounded-full ${cat.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Node Disk Utilization ({nodePct.toFixed(1)}%)
            </span>
            <button
              type="button"
              onClick={() => setActiveNav('trash')}
              className="text-[#2563EB] dark:text-[#38BDF8] font-semibold hover:underline"
            >
              Empty Trash ({formatBytes(breakdown.trashedBytes)})
            </button>
          </div>
        </div>
      </section>

      {/* Large Files & Scalable Architecture Specs */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-4">
          <h2 className="font-display text-base font-semibold">Largest Files in Library</h2>
          {largeFiles.length === 0 ? (
            <p className="text-xs text-slate-400">No files stored yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {largeFiles.map((lf) => (
                <div key={lf.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{lf.name}</div>
                    <div className="text-[11px] text-slate-400 capitalize">
                      {lf.mediaKind} · {formatShortDate(lf.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono tabular-nums font-semibold">{formatBytes(lf.sizeBytes, 2)}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/files/${lf.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isTrashed: true }),
                        });
                        await Promise.all([refreshLibrary(), refreshStorage()]);
                        pushToast({ kind: 'info', title: 'Moved to Trash', description: lf.name });
                      }}
                      className="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500"
                      title="Move to Trash"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 p-6 rounded-2xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="font-display text-base font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-[#38BDF8]" />
            Object Storage Architecture
          </h2>
          <dl className="space-y-3 text-xs pt-1">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Active Storage Backend</dt>
              <dd className="font-medium mt-0.5">{architecture.provider}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Shared Object Deduplication</dt>
              <dd className="font-medium mt-0.5">
                {architecture.deduplicatedSharing
                  ? 'Enabled — shared files & copies reference the underlying object without double-counting platform capacity.'
                  : 'Disabled'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Access Control</dt>
              <dd className="font-medium mt-0.5">
                Confined private storage objects served exclusively via HMAC-SHA256 short-lived signed URLs.
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Permanent Retention</dt>
              <dd className="font-medium mt-0.5">
                All images and files are stored on this website permanently and remain available even after signing out of an account (only permanent deletion from Trash removes objects).
              </dd>
            </div>
          </dl>
          <div className="pt-2 flex items-center gap-2 text-[11px] text-slate-400">
            <HardDrive className="w-3.5 h-3.5" />
            <span>Byte calculations strictly reflect actual persisted database & object sizes.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
