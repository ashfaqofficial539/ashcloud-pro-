import React from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, RefreshCw, X, XCircle } from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { formatBytes } from '../lib/format';

export function UploadManagerDrawer() {
  const {
    uploadTasks,
    uploadDrawerOpen,
    setUploadDrawerOpen,
    retryUpload,
    cancelUpload,
    clearFinishedUploads,
  } = useAshcloud();

  if (uploadTasks.length === 0) return null;

  const activeCount = uploadTasks.filter((t) => t.status === 'uploading' || t.status === 'pending').length;
  const completedCount = uploadTasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-md rounded-xl bg-white dark:bg-[#1F2937] border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold truncate">
          {activeCount > 0
            ? `Uploading ${activeCount} item${activeCount > 1 ? 's' : ''}`
            : `Uploads · ${completedCount} completed`}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {activeCount === 0 && (
            <button
              type="button"
              onClick={clearFinishedUploads}
              className="text-[11px] font-medium text-[#2563EB] dark:text-[#38BDF8] hover:underline px-1.5 py-0.5"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setUploadDrawerOpen(!uploadDrawerOpen)}
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label={uploadDrawerOpen ? 'Minimize upload manager' : 'Expand upload manager'}
          >
            {uploadDrawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {uploadDrawerOpen && (
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {uploadTasks.map((task) => (
            <div key={task.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{task.name}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 tabular-nums">
                    <span>{formatBytes(task.sizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{task.destinationLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{task.status}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {task.status === 'completed' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  )}
                  {(task.status === 'failed' || task.status === 'cancelled') && (
                    <>
                      <XCircle className="w-4 h-4 text-red-500" />
                      <button
                        type="button"
                        onClick={() => retryUpload(task.id)}
                        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[#2563EB] dark:text-[#38BDF8]"
                        title="Retry upload"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  {(task.status === 'pending' || task.status === 'uploading') && (
                    <button
                      type="button"
                      onClick={() => cancelUpload(task.id)}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-red-500"
                      title="Cancel upload"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      task.status === 'failed' || task.status === 'cancelled'
                        ? 'bg-red-500'
                        : task.status === 'completed'
                        ? 'bg-emerald-500'
                        : 'bg-[#2563EB]'
                    }`}
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 w-9 text-right tabular-nums">
                  {task.progress}%
                </span>
              </div>

              {task.error && (
                <p className="text-[11px] text-red-500">{task.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
