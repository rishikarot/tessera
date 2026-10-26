import { CHOICE_COLORS, PRIMARY_FIELD_TYPES, ROLLUP_AGGREGATES, type Choice, type Field, type FieldType, type Module } from '@tessera/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, endpoints } from '../lib/api';
import { COMING_LATER, FIELD_GROUPS, FIELD_LABELS } from '../lib/fieldMeta';
import { Dialog } from './Overlay';

type Config = Record<string, any>;

function ChoicesEditor({ choices, onChange }: { choices: Choice[]; onChange: (c: Choice[]) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {choices.map((c, i) => (
        <div key={c.id || i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            className="select"
            style={{ width: 96, background: `var(--c-${c.color}-bg)`, color: `var(--c-${c.color}-ink)` }}
            value={c.color}
            aria-label="Option colour"
            onChange={(e) => onChange(choices.map((x, j) => (j === i ? { ...x, color: e.target.value as Choice['color'] } : x)))}
          >
            {CHOICE_COLORS.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
          <input className="input" value={c.name} aria-label="Option name" onChange={(e) => onChange(choices.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <button type="button" className="btn btn-ghost icon-btn" aria-label={`Remove ${c.name}`} onClick={() => onChange(choices.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...choices, { id: '', name: `Option ${choices.length + 1}`, color: CHOICE_COLORS[(choices.length + 1) % CHOICE_COLORS.length]! }])}
      >
        + Add option
      </button>
    </div>
  );
}

function ConfigEditor({ type, config, set, fields, modules, moduleId, isNew }: { type: FieldType; config: Config; set: (patch: Config) => void; fields: Field[]; modules: Module[]; moduleId: string; isNew: boolean }) {
  const linkFields = fields.filter((f) => f.type === 'linkedRecord');
  const link = linkFields.find((f) => f.id === config.linkFieldId);
  const targetModuleId = link?.config.targetModuleId as string | undefined;
  const target = useQuery({ queryKey: ['module', targetModuleId], queryFn: () => endpoints.module(targetModuleId!), enabled: Boolean(targetModuleId) });

  switch (type) {
    case 'number':
    case 'percent':
    case 'currency':
      return (
        <div style={{ display: 'flex', gap: 12 }}>
          {type === 'currency' && (
            <div className="field-row" style={{ flex: 1 }}>
              <label className="label" htmlFor="cfg-symbol">Symbol</label>
              <input id="cfg-symbol" className="input" value={config.symbol ?? '$'} onChange={(e) => set({ symbol: e.target.value })} />
            </div>
          )}
          <div className="field-row" style={{ flex: 1 }}>
            <label className="label" htmlFor="cfg-precision">Decimal places</label>
            <select id="cfg-precision" className="select" value={config.precision ?? (type === 'currency' ? 2 : 0)} onChange={(e) => set({ precision: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      );
    case 'duration':
      return (
        <div className="field-row">
          <label className="label" htmlFor="cfg-dur">Format</label>
          <select id="cfg-dur" className="select" value={config.format ?? 'h:mm'} onChange={(e) => set({ format: e.target.value })}>
            <option value="h:mm">h:mm</option>
            <option value="h:mm:ss">h:mm:ss</option>
          </select>
        </div>
      );
    case 'rating':
      return (
        <div className="field-row">
          <label className="label" htmlFor="cfg-max">Maximum</label>
          <select id="cfg-max" className="select" value={config.max ?? 5} onChange={(e) => set({ max: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      );
    case 'singleSelect':
    case 'multipleSelect':
      return (
        <div className="field-row">
          <span className="label">Options</span>
          <ChoicesEditor choices={config.choices ?? []} onChange={(choices) => set({ choices })} />
        </div>
      );
    case 'date':
      return (
        <label className="check" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={Boolean(config.includeTime)} onChange={(e) => set({ includeTime: e.target.checked })} /> Include a time
        </label>
      );
    case 'user':
      return (
        <label className="check" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={Boolean(config.allowMultiple)} onChange={(e) => set({ allowMultiple: e.target.checked })} /> Allow several people
        </label>
      );
    case 'linkedRecord':
      return (
        <>
          <div className="field-row">
            <label className="label" htmlFor="cfg-target">Link to</label>
            <select id="cfg-target" className="select" disabled={!isNew} value={config.targetModuleId ?? ''} onChange={(e) => set({ targetModuleId: e.target.value })}>
              <option value="" disabled>Choose a module</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>{m.id === moduleId ? `${m.name} (this module)` : m.name}</option>
              ))}
            </select>
          </div>
          <label className="check" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={config.allowMultiple !== false} onChange={(e) => set({ allowMultiple: e.target.checked })} /> Allow linking to several records
          </label>
        </>
      );
    case 'lookup':
    case 'rollup':
    case 'count':
      return (
        <>
          <div className="field-row">
            <label className="label" htmlFor="cfg-link">Linked record field</label>
            <select id="cfg-link" className="select" value={config.linkFieldId ?? ''} onChange={(e) => set({ linkFieldId: e.target.value, targetFieldId: undefined })}>
              <option value="" disabled>{linkFields.length ? 'Choose a field' : 'Add a link field first'}</option>
              {linkFields.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          {type !== 'count' && target.data && (
            <div className="field-row">
              <label className="label" htmlFor="cfg-tfield">Field from {target.data.module.name}</label>
              <select id="cfg-tfield" className="select" value={config.targetFieldId ?? ''} onChange={(e) => set({ targetFieldId: e.target.value })}>
                <option value="" disabled>Choose a field</option>
                {target.data.fields.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
          {type === 'rollup' && (
            <div className="field-row">
              <label className="label" htmlFor="cfg-agg">Summarise as</label>
              <select id="cfg-agg" className="select" value={config.aggregate ?? 'sum'} onChange={(e) => set({ aggregate: e.target.value })}>
                {ROLLUP_AGGREGATES.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          )}
        </>
      );
    case 'formula':
      return (
        <div className="field-row">
          <label className="label" htmlFor="cfg-formula">Formula</label>
          <textarea id="cfg-formula" className="textarea" placeholder="{Value} * 0.2" value={config.expression ?? ''} onChange={(e) => set({ expression: e.target.value })} />
        </div>
      );
    case 'button':
      return (
        <>
          <div className="field-row">
            <label className="label" htmlFor="cfg-blabel">Label</label>
            <input id="cfg-blabel" className="input" value={config.label ?? 'Open'} onChange={(e) => set({ label: e.target.value })} />
          </div>
          <div className="field-row">
            <label className="label" htmlFor="cfg-burl">Opens this URL</label>
            <input id="cfg-burl" className="input" placeholder="https://" value={config.action?.url ?? ''} onChange={(e) => set({ action: e.target.value ? { kind: 'url', url: e.target.value } : undefined })} />
          </div>
        </>
      );
    case 'ai':
      return (
        <div className="field-row">
          <label className="label" htmlFor="cfg-prompt">Prompt</label>
          <textarea id="cfg-prompt" className="textarea" placeholder="Summarise the notes in one sentence" value={config.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} />
        </div>
      );
    default:
      return null;
  }
}

export function FieldDialog({ moduleId, field, fields, modules, onClose }: { moduleId: string; field?: Field; fields: Field[]; modules: Module[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(field?.name ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'singleLineText');
  const [description, setDescription] = useState(field?.description ?? '');
  const [required, setRequired] = useState(field?.required ?? false);
  const [config, setConfig] = useState<Config>(field?.config ?? {});
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), type, description: description || null, required, config };
      return field ? endpoints.updateField(field.id, typeChanged ? body : { ...body, type: undefined }) : endpoints.createField(moduleId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['module'] });
      qc.invalidateQueries({ queryKey: ['records'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the field'),
  });
  const typeChanged = Boolean(field) && field!.type !== type;
  const lockedType = field?.type === 'linkedRecord';

  return (
    <Dialog title={field ? 'Edit field' : 'New field'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError('Give the field a name');
          save.mutate();
        }}
      >
        <div className="field-row">
          <label className="label" htmlFor="f-name">Name</label>
          <input id="f-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field-row">
          <label className="label" htmlFor="f-type">Type</label>
          <select
            id="f-type"
            className="select"
            value={type}
            disabled={lockedType}
            onChange={(e) => {
              setType(e.target.value as FieldType);
              setConfig(field && field.type === e.target.value ? field.config : {});
            }}
          >
            {FIELD_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.types
                  .filter((t) => t !== 'linkedRecord' || !field || lockedType)
                  .map((t) => (
                    <option key={t} value={t} disabled={Boolean(field?.isPrimary) && !PRIMARY_FIELD_TYPES.has(t)}>
                      {FIELD_LABELS[t]}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {COMING_LATER[type] && <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>{COMING_LATER[type]}.</span>}
          {typeChanged && <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>Existing values are converted where possible; the rest are cleared.</span>}
        </div>
        <ConfigEditor type={type} config={config} set={(patch) => setConfig((c) => ({ ...c, ...patch }))} fields={fields} modules={modules} moduleId={moduleId} isNew={!field} />
        <div className="field-row">
          <label className="label" htmlFor="f-desc">Description</label>
          <input id="f-desc" className="input" placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        {error && <div className="error-text" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>{field ? 'Save' : 'Create field'}</button>
        </div>
      </form>
    </Dialog>
  );
}
