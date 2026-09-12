const BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** Access tokens live 15 minutes; this silently mints a new one from the
 * refresh cookie so an open tab doesn't hard-log-out mid-session. Dedups
 * concurrent 401s into a single refresh call. */
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  // FormData sets its own multipart Content-Type (with boundary) - never
  // override it, or the server can't parse the upload.
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) },
  });

  if (res.status === 401 && !isRetry && path !== "/auth/refresh" && path !== "/auth/login") {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
  downloadUrl: (versionId: string) => `${BASE}/documents/versions/${versionId}/download`,
  previewUrl: (versionId: string) => `${BASE}/documents/versions/${versionId}/download?inline=1`,
  certificateDownloadUrl: (id: string) => `${BASE}/type-test-certificates/${id}/download`,
  certificatePreviewUrl: (id: string) => `${BASE}/type-test-certificates/${id}/download?inline=1`,
};
