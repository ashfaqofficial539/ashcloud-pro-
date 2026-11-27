import React, { useEffect, useState } from 'react';
import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Heart,
  Info,
  Maximize2,
  MessageSquare,
  Play,
  Pause,
  Send,
  Share2,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';
import { formatBytes, formatRelativeTime, formatShortDate, isTextPreviewable } from '../lib/format';
import type { CloudFile } from '../types';
import { SaveToMyPhotosModal } from './SaveToMyPhotosModal';
import { ShareModal } from './ShareModal';

interface MediaViewerModalProps {
  items: CloudFile[];
  initialIndex: number;
  onClose: () => void;
  readOnly?: boolean;
  shareContextByFileId?: Record<
    string,
    { shareId: string; ownerName: string; permission: string; allowCopy: boolean }
  >;
}

interface CommentRecord {
  id: string;
  authorName: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
}

export function MediaViewerModal({
  items,
  initialIndex,
  onClose,
  readOnly = false,
  shareContextByFileId,
}: MediaViewerModalProps) {
  const { user, refreshLibrary, refreshStorage, pushToast, ensureFreshUrls } = useAshcloud();
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [slideshow, setSlideshow] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [textPreview, setTextPreview] = useState<{ text: string; truncated: boolean } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const file = items[index];
  const isOwner = Boolean(file && user && file.ownerId === user.id && file.savedMode !== 'reference');
  const shareCtx = file ? shareContextByFileId?.[file.id] : undefined;

  useEffect(() => {
    if (!file) return;
    setZoom(1);
    setTextPreview(null);
    ensureFreshUrls([file.id]).catch(() => {});

    // Mark file as recently opened
    apiFetch(`/api/files/${file.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ markOpened: true }),
    }).catch(() => {});

    if (isTextPreviewable(file.mimeType, file.name)) {
      apiFetch<{ text: string; truncated: boolean }>(`/api/files/${file.id}/text`)
        .then((res) => setTextPreview(res))
        .catch(() => setTextPreview(null));
    }

    if (!file.isVault) {
      apiFetch<{ comments: CommentRecord[] }>(`/api/comments/${file.id}`)
        .then((res) => setComments(res.comments || []))
        .catch(() => setComments([]));
    }
  }, [file?.id]);

  useEffect(() => {
    if (!slideshow || items.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, 3500);
    return () => clearInterval(timer);
  }, [slideshow, items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && items.length > 1) setIndex((i) => (i + 1) % items.length);
      if (e.key === 'ArrowLeft' && items.length > 1) setIndex((i) => (i - 1 + items.length) % items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  if (!file) return null;

  const toggleFavorite = async () => {
    if (!isOwner) return;
    await apiFetch(`/api/files/${file.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite: !file.isFavorite }),
    });
    await refreshLibrary();
    pushToast({ kind: 'success', title: file.isFavorite ? 'Removed from favorites' : 'Added to favorites' });
  };

  const moveToTrash = async () => {
    if (!isOwner) return;
    await apiFetch(`/api/files/${file.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isTrashed: true }),
    });
    await Promise.all([refreshLibrary(), refreshStorage()]);
    pushToast({ kind: 'info', title: 'Moved to Trash', description: file.name });
    onClose();
  };

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    try {
      const res = await apiFetch<{ comment: CommentRecord }>(`/api/comments/${file.id}`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody }),
      });
      setComments((prev) => [...prev, res.comment]);
      setCommentBody('');
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Comment blocked', description: err?.message });
    }
  };

  const requestFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0F19]/95 text-[#F8FAFC] flex flex-col">
      {/* Top viewer bar */}
      <div className="h-14 px-4 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close viewer"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{file.name}</div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 tabular-nums">
              <span>{formatBytes(file.sizeBytes)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatShortDate(file.takenAt || file.createdAt)}</span>
              {items.length > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {index + 1} / {items.length}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {file.mediaKind === 'photo' && (
            <>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                className="p-2 rounded-lg hover:bg-white/10"
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                className="p-2 rounded-lg hover:bg-white/10"
                title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSlideshow((s) => !s)}
                  className={`p-2 rounded-lg transition-colors ${slideshow ? 'bg-[#2563EB] text-white' : 'hover:bg-white/10'}`}
                  title={slideshow ? 'Pause slideshow' : 'Play slideshow'}
                >
                  {slideshow ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={requestFullscreen}
            className="hidden sm:inline-flex p-2 rounded-lg hover:bg-white/10"
            title="Toggle fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          {!readOnly && isOwner && (
            <button
              type="button"
              onClick={toggleFavorite}
              className="p-2 rounded-lg hover:bg-white/10"
              title="Favorite"
            >
              <Heart className={`w-4 h-4 ${file.isFavorite ? 'fill-rose-500 text-rose-500' : ''}`} />
            </button>
          )}
          {shareCtx && (file.mediaKind === 'photo' || file.mediaKind === 'video') && (
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold mr-1"
              title="Save to My Photos"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save to My Photos</span>
            </button>
          )}
          {!readOnly && isOwner && !file.isVault && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="p-2 rounded-lg hover:bg-white/10"
              title="Share"
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}
          <a
            href={file.downloadUrl}
            download={file.name}
            className="p-2 rounded-lg hover:bg-white/10"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
          {!file.isVault && (
            <button
              type="button"
              onClick={() => {
                setShowComments((c) => !c);
                setShowInfo(false);
              }}
              className={`p-2 rounded-lg ${showComments ? 'bg-[#2563EB]' : 'hover:bg-white/10'}`}
              title="Comments"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowInfo((i) => !i);
              setShowComments(false);
            }}
            className={`p-2 rounded-lg ${showInfo ? 'bg-[#2563EB]' : 'hover:bg-white/10'}`}
            title="File metadata"
          >
            <Info className="w-4 h-4" />
          </button>
          {!readOnly && isOwner && (
            <button
              type="button"
              onClick={moveToTrash}
              className="p-2 rounded-lg hover:bg-red-500/20 text-red-400"
              title="Move to Trash"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main viewport + side panel */}
      <div className="flex-1 flex min-h-0 relative">
        <div className="flex-1 relative flex items-center justify-center p-4 sm:p-8 overflow-auto">
          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
                className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-10 p-2.5 rounded-full bg-black/50 hover:bg-black/80 border border-white/10"
                aria-label="Previous item"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % items.length)}
                className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 z-10 p-2.5 rounded-full bg-black/50 hover:bg-black/80 border border-white/10"
                aria-label="Next item"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {file.mediaKind === 'photo' && (
            <img
              src={file.url}
              alt={file.name}
              referrerPolicy="no-referrer"
              style={{ transform: `scale(${zoom})` }}
              className="max-h-full max-w-full object-contain transition-transform duration-150 select-none rounded-lg"
            />
          )}

          {file.mediaKind === 'video' && (
            <video
              key={file.id}
              src={file.url}
              controls
              autoPlay
              className="max-h-full max-w-full rounded-lg bg-black"
            >
              Your browser does not support playback of this video codec. Use Download to play locally.
            </video>
          )}

          {file.mediaKind === 'audio' && (
            <div className="p-8 rounded-2xl bg-[#1F2937] border border-white/10 text-center space-y-4 max-w-md w-full">
              <div className="text-base font-semibold">{file.name}</div>
              <audio key={file.id} src={file.url} controls className="w-full" />
            </div>
          )}

          {file.mimeType === 'application/pdf' && (
            <iframe
              src={file.url}
              title={file.name}
              className="w-full h-full max-w-4xl rounded-xl bg-white"
            />
          )}

          {file.mediaKind !== 'photo' &&
            file.mediaKind !== 'video' &&
            file.mediaKind !== 'audio' &&
            file.mimeType !== 'application/pdf' &&
            (textPreview ? (
              <div className="w-full max-w-4xl max-h-full overflow-auto rounded-xl bg-[#111827] border border-white/10 p-6 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
                {textPreview.text}
                {textPreview.truncated && (
                  <div className="mt-4 pt-3 border-t border-white/10 text-slate-400">
                    Preview truncated to 256 KB. Download file for full contents.
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-[#1F2937] border border-white/10 text-center space-y-4 max-w-sm">
                <FileText className="w-12 h-12 text-[#38BDF8] mx-auto" />
                <div>
                  <div className="text-sm font-semibold">{file.name}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Inline preview unavailable for {file.mimeType}.
                  </div>
                </div>
                <a
                  href={file.downloadUrl}
                  download={file.name}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
                >
                  <Download className="w-4 h-4" />
                  Download ({formatBytes(file.sizeBytes)})
                </a>
              </div>
            ))}
        </div>

        {/* Side Info / Comments Drawer */}
        {(showInfo || showComments) && (
          <aside className="w-80 bg-[#1F2937] border-l border-white/10 p-5 flex flex-col shrink-0 overflow-y-auto">
            {showInfo && (
              <div className="space-y-4">
                <h3 className="font-display text-sm font-semibold">File Metadata</h3>
                <dl className="space-y-3 text-xs">
                  <div>
                    <dt className="text-slate-400">Name</dt>
                    <dd className="font-medium break-all mt-0.5">{file.name}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Size</dt>
                    <dd className="font-mono tabular-nums mt-0.5">{formatBytes(file.sizeBytes)} ({file.sizeBytes.toLocaleString()} bytes)</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">MIME Type</dt>
                    <dd className="font-mono mt-0.5">{file.mimeType}</dd>
                  </div>
                  {file.width && file.height && (
                    <div>
                      <dt className="text-slate-400">Dimensions</dt>
                      <dd className="font-mono tabular-nums mt-0.5">
                        {file.width} × {file.height} px
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-slate-400">Uploaded</dt>
                    <dd className="mt-0.5">{formatShortDate(file.createdAt)}</dd>
                  </div>
                  {file.ownerName && (
                    <div>
                      <dt className="text-slate-400">Owner</dt>
                      <dd className="mt-0.5">{file.ownerName}</dd>
                    </div>
                  )}
                  {file.sourceProvider && (
                    <div>
                      <dt className="text-slate-400">Source</dt>
                      <dd className="mt-0.5 capitalize">{file.sourceProvider.replace('_', ' ')}</dd>
                    </div>
                  )}
                  {file.savedMode && (
                    <div>
                      <dt className="text-slate-400">Library Mode</dt>
                      <dd className="mt-0.5">
                        {file.savedMode === 'reference'
                          ? 'Shared Reference (0 B extra)'
                          : `Saved Independent Copy${file.copiedFromOwnerName ? ` (from ${file.copiedFromOwnerName})` : ''}`}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {showComments && (
              <div className="flex-1 flex flex-col min-h-0">
                <h3 className="font-display text-sm font-semibold mb-3">Comments</h3>
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {comments.length === 0 ? (
                    <p className="text-xs text-slate-400">No comments yet.</p>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="p-3 rounded-lg bg-[#111827] border border-white/5 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-[#38BDF8]">{c.authorName}</span>
                          <span className="text-slate-400 tabular-nums">{formatRelativeTime(c.createdAt)}</span>
                        </div>
                        <p className="text-xs text-slate-200 leading-relaxed">{c.body}</p>
                      </div>
                    ))
                  )}
                </div>
                {(isOwner || file.permission === 'commenter' || file.permission === 'editor') && (
                  <form onSubmit={postComment} className="mt-3 pt-3 border-t border-white/10 flex gap-2">
                    <input
                      type="text"
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      placeholder="Write a comment..."
                      className="flex-1 px-3 py-2 text-xs rounded-lg bg-[#111827] border border-white/10 focus:outline-none focus:border-[#38BDF8]"
                    />
                    <button
                      type="submit"
                      className="p-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white"
                      aria-label="Send comment"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {shareOpen && (
        <ShareModal
          resourceType="file"
          resourceId={file.id}
          resourceName={file.name}
          isVault={file.isVault}
          onClose={() => setShareOpen(false)}
        />
      )}

      {saveOpen && shareCtx && (
        <SaveToMyPhotosModal
          file={file}
          shareId={shareCtx.shareId}
          ownerName={shareCtx.ownerName}
          permission={shareCtx.permission}
          allowCopy={shareCtx.allowCopy}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </div>
  );
}
