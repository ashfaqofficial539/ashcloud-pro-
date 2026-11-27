// In-memory session & vault tokens (never persisted in localStorage/sessionStorage)
let authToken: string | null = null;
let vaultToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setVaultToken(token: string | null) {
  vaultToken = token;
}

export function getVaultToken(): string | null {
  return vaultToken;
}

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 5) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (vaultToken && !headers.has('X-Vault-Token')) {
    headers.set('X-Vault-Token', vaultToken);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers });

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    throw new RateLimitError(
      data.error || 'Too many requests. Please wait a moment and try again.',
      Number(data.retryAfterSeconds) || 5
    );
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export function uploadFileWithProgress(params: {
  file: File;
  folderId: string | null;
  relativePath?: string;
  isVault: boolean;
  duplicateAction: 'keep_both' | 'skip' | 'replace';
  onProgress: (pct: number) => void;
  onAbortReady: (abortFn: () => void) => void;
}): Promise<{ file: any; skipped?: boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    if (vaultToken) xhr.setRequestHeader('X-Vault-Token', vaultToken);

    params.onAbortReady(() => xhr.abort());

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
        params.onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 429) {
        reject(new RateLimitError('Upload rate limit reached. Please retry shortly.', 5));
        return;
      }
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        params.onProgress(100);
        resolve(body);
      } else {
        reject(new ApiError(body.error || `Upload failed (${xhr.status})`, xhr.status, body.code));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 499, 'CANCELLED'));

    const form = new FormData();
    form.append('file', params.file);
    form.append('name', params.file.name);
    if (params.folderId) form.append('folderId', params.folderId);
    if (params.relativePath) form.append('relativePath', params.relativePath);
    form.append('isVault', params.isVault ? 'true' : 'false');
    form.append('duplicateAction', params.duplicateAction);

    xhr.send(form);
  });
}
