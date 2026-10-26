import { can } from '@tessera/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useMatch, useNavigate, useParams } from 'react-router-dom';
import { Dialog } from '../components/Overlay';
import { endpoints, setToken } from '../lib/api';
import { ModulePage } from './ModulePage';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" rx="2" fill="var(--ink)" />
      <rect x="12" y="1" width="9" height="9" rx="2" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      <rect x="1" y="12" width="9" height="9" rx="2" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      <rect x="12" y="12" width="9" height="9" rx="2" fill="var(--accent)" />
    </svg>
  );
}

function NameDialog({ title, label, cta, onSubmit, onClose }: { title: string; label: string; cta: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <label className="label" htmlFor="name-input">{label}</label>
        <input id="name-input" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>{cta}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function AppShell() {
  const { appId } = useParams();
  // The module id lives in the nested route, so read it from the URL here.
  const moduleId = useMatch('/a/:appId/m/:moduleId/*')?.params.moduleId;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'module' | 'app' | null>(null);

  const app = useQuery({ queryKey: ['app', appId], queryFn: () => endpoints.app(appId!) });
  const workspaceId = app.data?.workspaceId;
  const apps = useQuery({ queryKey: ['apps', workspaceId], queryFn: () => endpoints.apps(workspaceId!), enabled: Boolean(workspaceId) });
  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: () => endpoints.members(workspaceId!), enabled: Boolean(workspaceId) });
  const me = useQuery({ queryKey: ['me'], queryFn: endpoints.me });

  const createModule = useMutation({
    mutationFn: (name: string) => endpoints.createModule(appId!, name),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['app', appId] });
      navigate(`/a/${appId}/m/${s.module.id}`);
    },
  });
  const createApp = useMutation({
    mutationFn: (name: string) => endpoints.createApp(workspaceId!, name),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['apps', workspaceId] });
      navigate(`/a/${a.id}`);
    },
  });

  const first = app.data?.modules[0];
  useEffect(() => {
    if (!moduleId && first) navigate(`/a/${appId}/m/${first.id}`, { replace: true });
  }, [moduleId, first, appId, navigate]);

  if (app.isError) return <div className="empty">This app could not be found. <Link to="/">Go home</Link></div>;
  const canEditSchema = can(app.data?.role, 'schema.edit');

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="App">
        <div className="brand">
          <Logo />
          Tessera
        </div>
        <div className="nav-section">
          <label htmlFor="app-switch" className="nav-heading">App</label>
          <select
            id="app-switch"
            className="select"
            value={appId}
            onChange={(e) => (e.target.value === '__new' ? setDialog('app') : navigate(`/a/${e.target.value}`))}
          >
            {apps.data?.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            {canEditSchema && <option value="__new">+ New app</option>}
          </select>
        </div>
        <div className="nav-section">
          <div className="nav-heading">Modules</div>
          {app.data?.modules.map((m) => (
            <Link key={m.id} to={`/a/${appId}/m/${m.id}`} className={`nav-item${m.id === moduleId ? ' active' : ''}`} aria-current={m.id === moduleId ? 'page' : undefined}>
              {m.name}
            </Link>
          ))}
          {canEditSchema && (
            <button type="button" className="nav-item muted" onClick={() => setDialog('module')}>
              + New module
            </button>
          )}
        </div>
        <div className="nav-section" style={{ marginTop: 'auto' }}>
          <span className="nav-item muted" title="Arrives in Phase 2">Automations</span>
          <span className="nav-item muted" title="Arrives in Phase 3">Interfaces</span>
          <div className="nav-item" style={{ cursor: 'default' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.data?.name}</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 26, padding: '0 6px', fontSize: 12 }}
              onClick={() => {
                setToken(null);
                qc.clear();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="main">
        {app.data && app.data.modules.length === 0 && (
          <div className="empty">
            <p>This app has no modules yet. A module is a table of records, like Deals, Contacts or Tasks.</p>
            {canEditSchema && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('module')}>
                Create a module
              </button>
            )}
          </div>
        )}
        {app.data && (
          <Routes>
            <Route path="m/:moduleId" element={<ModulePage modules={app.data.modules} members={members.data ?? []} />} />
            <Route path="m/:moduleId/v/:viewId" element={<ModulePage modules={app.data.modules} members={members.data ?? []} />} />
          </Routes>
        )}
      </main>

      {dialog === 'module' && (
        <NameDialog title="New module" label="Module name" cta="Create module" onClose={() => setDialog(null)} onSubmit={(n) => (createModule.mutate(n), setDialog(null))} />
      )}
      {dialog === 'app' && <NameDialog title="New app" label="App name" cta="Create app" onClose={() => setDialog(null)} onSubmit={(n) => (createApp.mutate(n), setDialog(null))} />}
    </div>
  );
}
