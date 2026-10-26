import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ApiError, endpoints, getToken, setToken } from '../lib/api';
import { ModuleProvider } from '../lib/moduleContext';
import { FormRenderer } from '../views/FormView';
import { Logo } from './AppShell';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const login = useMutation({
    mutationFn: () => endpoints.login(email, name || undefined),
    onSuccess: ({ token }) => {
      setToken(token);
      navigate('/');
    },
  });
  return (
    <div className="center-page">
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <Logo size={28} />
        <h1>Sign in to Tessera</h1>
        <p className="muted" style={{ marginTop: 0 }}>Development sign-in: enter any email to continue.</p>
        <div className="field-row">
          <label className="label" htmlFor="login-email">Email</label>
          <input id="login-email" className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field-row">
          <label className="label" htmlFor="login-name">Name</label>
          <input id="login-name" className="input" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {login.isError && <div className="error-text" role="alert">{login.error instanceof ApiError ? login.error.message : 'Could not sign in'}</div>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 38, justifyContent: 'center' }} disabled={login.isPending}>
          Continue
        </button>
      </form>
    </div>
  );
}

/** Sends the user to their first app, creating a workspace and app on first visit. */
export function HomePage() {
  const navigate = useNavigate();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: endpoints.workspaces, enabled: Boolean(getToken()) });
  const setup = useMutation({
    mutationFn: async () => {
      const ws = workspaces.data?.[0] ?? (await endpoints.createWorkspace('My workspace'));
      const apps = await endpoints.apps(ws.id);
      return apps[0] ?? (await endpoints.createApp(ws.id, 'My first app'));
    },
    onSuccess: (app) => navigate(`/a/${app.id}`, { replace: true }),
  });
  useEffect(() => {
    if (workspaces.data && setup.isIdle) setup.mutate();
  }, [workspaces.data, setup]);
  if (!getToken() || (workspaces.error instanceof ApiError && workspaces.error.status === 401)) return <Navigate to="/login" replace />;
  return <div className="empty">{setup.isError ? 'Could not open your workspace.' : 'Opening your workspace…'}</div>;
}

export function PublicFormPage() {
  const { viewId } = useParams();
  const form = useQuery({ queryKey: ['form', viewId], queryFn: () => endpoints.form(viewId!), retry: false });
  if (form.isError) return <div className="empty">This form is not available.</div>;
  if (!form.data) return <div className="empty">Loading…</div>;
  const stub = {
    module: { id: '', appId: '', name: form.data.title, description: null, primaryFieldId: null, position: 0 },
    fields: form.data.fields,
    views: [],
    role: 'readOnly' as const,
  };
  return (
    <ModuleProvider schema={stub} members={[]} linkedNames={{}}>
      <div className="form-page">
        <FormRenderer
          title={form.data.title}
          description={form.data.description}
          submitLabel={form.data.submitLabel}
          fields={form.data.fields}
          onSubmit={async (values) => (await endpoints.submitForm(viewId!, values)).message}
        />
        <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 20, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
          <Logo size={14} /> Made with Tessera
        </p>
      </div>
    </ModuleProvider>
  );
}
