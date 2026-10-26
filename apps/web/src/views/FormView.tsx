import { isComputed, type Field, type View, type ViewConfig } from '@tessera/shared';
import { useState } from 'react';
import { FieldInput } from '../components/FieldInput';
import { ApiError, endpoints } from '../lib/api';
import { useModule } from '../lib/moduleContext';

/** The form people fill in; shared by the builder preview and the public page. */
export function FormRenderer({
  title,
  description,
  submitLabel,
  fields,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  fields: Field[];
  onSubmit: (values: Record<string, unknown>) => Promise<string>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (done) {
    return (
      <div className="form-card" role="status">
        <p style={{ margin: 0 }}>{done}</p>
        <button type="button" className="btn" style={{ marginTop: 16 }} onClick={() => (setDone(null), setValues({}))}>
          Submit another response
        </button>
      </div>
    );
  }

  return (
    <form
      className="form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        const missing = Object.fromEntries(fields.filter((f) => f.required && (values[f.id] === undefined || values[f.id] === '' || values[f.id] === null)).map((f) => [f.id, 'Required']));
        setErrors(missing);
        if (Object.keys(missing).length) return;
        setBusy(true);
        try {
          setDone(await onSubmit(values));
        } catch (err) {
          setErrors(err instanceof ApiError ? err.details?.fields ?? { _: err.message } : { _: 'Could not submit the form' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 style={{ margin: '0 0 6px', fontSize: 22, letterSpacing: '-0.02em' }}>{title || 'Untitled form'}</h1>
      {description && <p className="muted" style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{description}</p>}
      <div style={{ marginTop: 20 }}>
        {fields.map((f) => (
          <div key={f.id} className="field-row">
            <label className="label" htmlFor={`form-${f.id}`} style={{ color: 'var(--ink)', fontSize: 13, fontWeight: 500 }}>
              {f.name}
              {f.required && <span aria-hidden="true"> *</span>}
            </label>
            {f.description && <span className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{f.description}</span>}
            <FieldInput id={`form-${f.id}`} field={f} value={values[f.id]} live onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
            {errors[f.id] && <span className="error-text" role="alert">{errors[f.id]}</span>}
          </div>
        ))}
      </div>
      {errors._ && <div className="error-text" role="alert">{errors._}</div>}
      <button type="submit" className="btn btn-primary" disabled={busy} style={{ marginTop: 8, height: 38, padding: '0 18px' }}>
        {submitLabel || 'Submit'}
      </button>
    </form>
  );
}

/** Builder for a form view: pick the fields, write the copy, share the link. */
export function FormView({ view, onChangeView, canEdit }: { view: View; onChangeView: (patch: Partial<ViewConfig>) => void; canEdit: boolean }) {
  const { schema } = useModule();
  const form = view.config.form;
  const setForm = (patch: Partial<ViewConfig['form']>) => onChangeView({ form: { ...form, ...patch } });
  const eligible = schema.fields.filter((f) => !isComputed(f.type));
  const shown = form.fieldIds.map((id) => schema.fields.find((f) => f.id === id)).filter(Boolean) as Field[];
  const link = `${window.location.origin}/form/${view.id}`;

  return (
    <div className="split">
      <aside>
        <div className="field-row">
          <label className="label" htmlFor="form-title">Title</label>
          <input id="form-title" className="input" disabled={!canEdit} defaultValue={form.title} onBlur={(e) => setForm({ title: e.target.value })} />
        </div>
        <div className="field-row">
          <label className="label" htmlFor="form-desc">Introduction</label>
          <textarea id="form-desc" className="textarea" disabled={!canEdit} defaultValue={form.description} onBlur={(e) => setForm({ description: e.target.value })} />
        </div>
        <span className="label">Questions</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 14 }}>
          {eligible.map((f) => (
            <label key={f.id} className="menu-item">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={form.fieldIds.includes(f.id)}
                onChange={(e) => setForm({ fieldIds: e.target.checked ? [...form.fieldIds, f.id] : form.fieldIds.filter((id) => id !== f.id) })}
              />
              {f.name}
              {f.type === 'linkedRecord' && <span className="muted" style={{ fontSize: 12 }}>(not on public forms)</span>}
            </label>
          ))}
        </div>
        <div className="field-row">
          <label className="label" htmlFor="form-success">Message after submitting</label>
          <input id="form-success" className="input" disabled={!canEdit} defaultValue={form.successMessage} onBlur={(e) => setForm({ successMessage: e.target.value })} />
        </div>
        <label className="check" style={{ marginBottom: 10 }}>
          <input type="checkbox" disabled={!canEdit} checked={form.isPublic} onChange={(e) => setForm({ isPublic: e.target.checked })} /> Anyone with the link can submit
        </label>
        {form.isPublic && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" readOnly value={link} aria-label="Form link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(link)}>
              Copy
            </button>
          </div>
        )}
      </aside>
      <section>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Preview. Submitting here adds a real record.</p>
          <FormRenderer
            title={form.title || schema.module.name}
            description={form.description}
            submitLabel={form.submitLabel}
            fields={shown}
            onSubmit={async (values) => {
              await endpoints.createRecords(schema.module.id, [{ values }]);
              return form.successMessage;
            }}
          />
        </div>
      </section>
    </div>
  );
}
