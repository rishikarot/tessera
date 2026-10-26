import { VIEW_TYPES, can, type Field, type Module, type View, type ViewConfig, type ViewType } from '@tessera/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FieldDialog } from '../components/FieldDialog';
import { Popover } from '../components/Overlay';
import { RecordDrawer } from '../components/RecordDrawer';
import { ViewToolbar } from '../components/ViewToolbar';
import { endpoints, type Member } from '../lib/api';
import { ModuleProvider } from '../lib/moduleContext';
import { FormView } from '../views/FormView';
import { GridView } from '../views/GridView';
import { KanbanView } from '../views/KanbanView';

const VIEW_LABELS: Record<ViewType, string> = {
  grid: 'Grid',
  kanban: 'Kanban',
  calendar: 'Calendar',
  gallery: 'Gallery',
  timeline: 'Timeline',
  list: 'List',
  gantt: 'Gantt',
  form: 'Form',
};
const READY: ViewType[] = ['grid', 'kanban', 'form'];

export function ModulePage({ modules, members }: { modules: Module[]; members: Member[] }) {
  const { appId, moduleId, viewId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [fieldDialog, setFieldDialog] = useState<{ field?: Field } | null>(null);
  const [addView, setAddView] = useState<HTMLElement | null>(null);

  const schema = useQuery({ queryKey: ['module', moduleId], queryFn: () => endpoints.module(moduleId!), enabled: Boolean(moduleId) });
  const view = schema.data?.views.find((v) => v.id === viewId) ?? schema.data?.views[0];
  const records = useQuery({
    queryKey: ['records', moduleId, view?.id, search],
    queryFn: () => endpoints.records(moduleId!, { viewId: view!.id, search }),
    enabled: Boolean(view) && view?.type !== 'form',
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    // Fix up a missing or stale view id in the URL once the views are loaded.
    if (view && view.id !== viewId && !schema.isFetching) navigate(`/a/${appId}/m/${moduleId}/v/${view.id}`, { replace: true });
  }, [view, viewId, appId, moduleId, navigate, schema.isFetching]);

  const updateView = useMutation({
    mutationFn: ({ id, config }: { id: string; config: ViewConfig }) => endpoints.updateView(id, { config }),
    onMutate: ({ id, config }) => {
      // Apply locally first so filters feel instant.
      qc.setQueryData(['module', moduleId], (old: typeof schema.data) => old && { ...old, views: old.views.map((v) => (v.id === id ? { ...v, config } : v)) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['module', moduleId] });
      qc.invalidateQueries({ queryKey: ['records', moduleId] });
    },
  });
  const createView = useMutation({
    mutationFn: (type: ViewType) => {
      const taken = new Set(schema.data?.views.map((v) => v.name));
      let name = VIEW_LABELS[type];
      for (let i = 2; taken.has(name); i++) name = `${VIEW_LABELS[type]} ${i}`;
      return endpoints.createView(moduleId!, { name, type });
    },
    onSuccess: (v: View) => {
      // Add it to the cache first, or the page falls back to the first view.
      qc.setQueryData(['module', moduleId], (old: typeof schema.data) => old && { ...old, views: [...old.views, v] });
      navigate(`/a/${appId}/m/${moduleId}/v/${v.id}`);
    },
  });
  const renameModule = useMutation({
    mutationFn: (name: string) => endpoints.updateModule(moduleId!, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app', appId] }),
  });

  if (schema.isError) return <div className="empty">This module could not be loaded.</div>;
  if (!schema.data || !view) return <div className="empty">Loading…</div>;

  const role = schema.data.role;
  const canEditSchema = can(role, 'schema.edit');
  const canEditRecords = can(role, 'record.edit');
  const canEditView =
    view.visibility === 'personal' ? true : view.visibility === 'locked' ? can(role, 'view.lock') : can(role, 'view.edit');
  const changeView = (patch: Partial<ViewConfig>) => canEditView && updateView.mutate({ id: view.id, config: { ...view.config, ...patch } });

  return (
    <ModuleProvider schema={schema.data} members={members} linkedNames={records.data?.linkedNames ?? {}}>
      <header className="page-header">
        {canEditSchema ? (
          <input
            key={schema.data.module.id}
            className="page-title"
            aria-label="Module name"
            defaultValue={schema.data.module.name}
            onBlur={(e) => e.target.value.trim() && e.target.value !== schema.data!.module.name && renameModule.mutate(e.target.value.trim())}
            style={{ border: 0, outline: 'none', padding: 0, background: 'none', minWidth: 0, flex: 1 }}
          />
        ) : (
          <h1 className="page-title">{schema.data.module.name}</h1>
        )}
        {canEditRecords && view.type !== 'form' && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              const { records: created } = await endpoints.createRecords(moduleId!, [{ values: {} }]);
              qc.invalidateQueries({ queryKey: ['records', moduleId] });
              if (created[0]) setOpenRecord(created[0].id);
            }}
          >
            New record
          </button>
        )}
      </header>

      <div className="toolbar">
        <div className="toolbar-group" role="tablist" aria-label="Views">
          {schema.data.views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view.id}
              className={`btn btn-ghost${v.id === view.id ? ' active' : ''}`}
              onClick={() => navigate(`/a/${appId}/m/${moduleId}/v/${v.id}`)}
              title={v.visibility === 'locked' ? 'Locked view' : v.visibility === 'personal' ? 'Personal view' : undefined}
            >
              {v.name}
              {v.visibility === 'locked' && <span aria-hidden="true"> ·</span>}
            </button>
          ))}
          <button type="button" className="btn btn-ghost icon-btn" aria-label="Add view" onClick={(e) => setAddView(e.currentTarget)}>
            +
          </button>
        </div>
        <ViewToolbar view={view} fields={schema.data.fields} onChange={changeView} search={search} onSearch={setSearch} canEdit={canEditView} />
      </div>

      <div className="view-body">
        {view.type === 'grid' && records.data && (
          <GridView
            view={view}
            records={records.data.records}
            onOpenRecord={setOpenRecord}
            onEditField={(field) => setFieldDialog({ field: field ?? undefined })}
            onChangeView={changeView}
            canEdit={canEditRecords}
            canEditSchema={canEditSchema}
          />
        )}
        {view.type === 'kanban' && records.data && <KanbanView view={view} records={records.data.records} onOpenRecord={setOpenRecord} onChangeView={changeView} canEdit={canEditRecords} />}
        {view.type === 'form' && <FormView view={view} onChangeView={changeView} canEdit={canEditView} />}
        {!READY.includes(view.type) && <div className="empty">{VIEW_LABELS[view.type]} views arrive in Phase 2. The view is saved and will light up then.</div>}
      </div>
      {view.type !== 'form' && records.data && (
        <div className="footer-bar">
          <span>
            {records.data.total} {records.data.total === 1 ? 'record' : 'records'}
          </span>
          <span>{view.visibility === 'collaborative' ? '' : `${view.visibility === 'locked' ? 'Locked' : 'Personal'} view`}</span>
        </div>
      )}

      {addView && (
        <Popover anchor={addView} onClose={() => setAddView(null)}>
          {VIEW_TYPES.map((t) => (
            <button key={t} type="button" className="menu-item" onClick={() => (createView.mutate(t), setAddView(null))}>
              {VIEW_LABELS[t]}
              {!READY.includes(t) && <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>Phase 2</span>}
            </button>
          ))}
        </Popover>
      )}
      {openRecord && <RecordDrawer recordId={openRecord} onClose={() => setOpenRecord(null)} />}
      {fieldDialog && <FieldDialog moduleId={moduleId!} field={fieldDialog.field} fields={schema.data.fields} modules={modules} onClose={() => setFieldDialog(null)} />}
    </ModuleProvider>
  );
}
