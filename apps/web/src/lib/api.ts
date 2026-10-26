import type { App, Field, Module, RecordRow, Role, View, Workspace } from '@tessera/shared';

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const TOKEN_KEY = 'tessera.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the session lasts until reload.
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { fields?: Record<string, string> } & Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, json.error ?? res.statusText, json.details);
  }
  return json as T;
}

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface ModuleSchema {
  module: Module;
  fields: Field[];
  views: View[];
  role: Role;
}

export interface RecordList {
  total: number;
  records: RecordRow[];
  linkedNames: Record<string, string>;
}

export const endpoints = {
  me: () => api<{ id: string; email: string; name: string }>('GET', '/me'),
  login: (email: string, name?: string) => api<{ token: string }>('POST', '/auth/dev-login', { email, name }),
  workspaces: () => api<Workspace[]>('GET', '/workspaces'),
  createWorkspace: (name: string) => api<Workspace>('POST', '/workspaces', { name }),
  members: (workspaceId: string) => api<Member[]>('GET', `/workspaces/${workspaceId}/members`),
  apps: (workspaceId: string) => api<App[]>('GET', `/workspaces/${workspaceId}/apps`),
  createApp: (workspaceId: string, name: string) => api<App>('POST', `/workspaces/${workspaceId}/apps`, { name }),
  app: (appId: string) => api<App & { modules: Module[]; role: Role }>('GET', `/apps/${appId}`),
  createModule: (appId: string, name: string) => api<ModuleSchema>('POST', `/apps/${appId}/modules`, { name }),
  updateModule: (moduleId: string, patch: Partial<Module>) => api<Module>('PATCH', `/modules/${moduleId}`, patch),
  deleteModule: (moduleId: string) => api<void>('DELETE', `/modules/${moduleId}`),
  module: (moduleId: string) => api<ModuleSchema>('GET', `/modules/${moduleId}`),
  createField: (moduleId: string, body: { name: string; type: string; config: Record<string, unknown>; description?: string | null; required?: boolean }) =>
    api<Field>('POST', `/modules/${moduleId}/fields`, body),
  updateField: (fieldId: string, patch: Record<string, unknown>) => api<Field>('PATCH', `/fields/${fieldId}`, patch),
  deleteField: (fieldId: string) => api<void>('DELETE', `/fields/${fieldId}`),
  createView: (moduleId: string, body: { name: string; type: string; visibility?: string; config?: unknown }) =>
    api<View>('POST', `/modules/${moduleId}/views`, body),
  updateView: (viewId: string, patch: Record<string, unknown>) => api<View>('PATCH', `/views/${viewId}`, patch),
  deleteView: (viewId: string) => api<void>('DELETE', `/views/${viewId}`),
  records: (moduleId: string, params: { viewId?: string; search?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.viewId) q.set('viewId', params.viewId);
    if (params.search) q.set('search', params.search);
    q.set('limit', String(params.limit ?? 1000));
    return api<RecordList>('GET', `/modules/${moduleId}/records?${q}`);
  },
  createRecords: (moduleId: string, records: { values: Record<string, unknown> }[]) =>
    api<{ records: RecordRow[] }>('POST', `/modules/${moduleId}/records`, { records }),
  record: (recordId: string) => api<RecordRow & { linkedNames: Record<string, string> }>('GET', `/records/${recordId}`),
  updateRecord: (recordId: string, values: Record<string, unknown>) =>
    api<RecordRow & { linkedNames: Record<string, string> }>('PATCH', `/records/${recordId}`, { values }),
  deleteRecord: (recordId: string) => api<void>('DELETE', `/records/${recordId}`),
  comments: (recordId: string) => api<{ id: string; authorId: string; body: string; createdAt: string }[]>('GET', `/records/${recordId}/comments`),
  addComment: (recordId: string, body: string) => api('POST', `/records/${recordId}/comments`, { body }),
  history: (recordId: string) =>
    api<{ id: string; actorId: string | null; action: string; changes: Record<string, { from: unknown; to: unknown }>; createdAt: string }[]>(
      'GET',
      `/records/${recordId}/history`,
    ),
  form: (viewId: string) => api<{ id: string; title: string; description: string; submitLabel: string; fields: Field[] }>('GET', `/forms/${viewId}`),
  submitForm: (viewId: string, values: Record<string, unknown>) => api<{ message: string }>('POST', `/forms/${viewId}`, { values }),
};
