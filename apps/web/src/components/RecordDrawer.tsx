import { cellToText, isComputed, type Field } from '@tessera/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, endpoints } from '../lib/api';
import { FIELD_GLYPHS } from '../lib/fieldMeta';
import { useModule } from '../lib/moduleContext';
import { FieldInput } from './FieldInput';

export function RecordDrawer({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { schema, members } = useModule();
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const record = useQuery({ queryKey: ['record', recordId], queryFn: () => endpoints.record(recordId) });
  const comments = useQuery({ queryKey: ['comments', recordId], queryFn: () => endpoints.comments(recordId), enabled: tab === 'comments' });
  const history = useQuery({ queryKey: ['history', recordId], queryFn: () => endpoints.history(recordId), enabled: tab === 'history' });
  const canEdit = ['owner', 'creator', 'editor'].includes(schema.role);
  const canComment = schema.role !== 'readOnly';

  const update = useMutation({
    mutationFn: ({ field, value }: { field: Field; value: unknown }) => endpoints.updateRecord(recordId, { [field.id]: value }),
    onSuccess: (data, { field }) => {
      setErrors((e) => ({ ...e, [field.id]: '' }));
      qc.setQueryData(['record', recordId], data);
      qc.invalidateQueries({ queryKey: ['records'] });
      qc.invalidateQueries({ queryKey: ['history', recordId] });
    },
    onError: (err, { field }) => setErrors((e) => ({ ...e, [field.id]: err instanceof ApiError ? err.details?.fields?.[field.id] ?? err.message : 'Could not save' })),
  });
  const addComment = useMutation({
    mutationFn: () => endpoints.addComment(recordId, comment),
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['comments', recordId] });
    },
  });
  const remove = useMutation({
    mutationFn: () => endpoints.deleteRecord(recordId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['records'] });
      onClose();
    },
  });

  const primary = schema.fields.find((f) => f.isPrimary);
  const title = record.data && primary ? cellToText(primary, record.data.values[primary.id]) || 'Unnamed record' : '';
  const who = (id: string | null) => members.find((m) => m.id === id)?.name ?? 'Someone';
  const fieldName = (id: string) => schema.fields.find((f) => f.id === id)?.name ?? 'A deleted field';

  return createPortal(
    <aside className="drawer" aria-label="Record">
      <div className="drawer-head">
        <strong style={{ fontSize: 16 }}>{title}</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-danger" onClick={() => confirm('Delete this record?') && remove.mutate()}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn-ghost icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="drawer-body">
        {record.data &&
          schema.fields.map((f) => (
            <div key={f.id} className="field-row">
              <label className="label" htmlFor={`rec-${f.id}`}>
                <span style={{ marginRight: 6 }}>{FIELD_GLYPHS[f.type]}</span>
                {f.name}
                {f.required && ' *'}
              </label>
              {canEdit || isComputed(f.type) ? (
                <FieldInput id={`rec-${f.id}`} field={f} value={record.data.values[f.id]} onChange={(value) => update.mutate({ field: f, value })} />
              ) : (
                <FieldInput field={f} value={record.data.values[f.id]} onChange={() => {}} />
              )}
              {f.description && <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>{f.description}</span>}
              {errors[f.id] && <span className="error-text" role="alert">{errors[f.id]}</span>}
            </div>
          ))}

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'comments'} className={`tab${tab === 'comments' ? ' active' : ''}`} onClick={() => setTab('comments')}>
            Comments
          </button>
          <button type="button" role="tab" aria-selected={tab === 'history'} className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            History
          </button>
        </div>

        {tab === 'comments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {comments.data?.length === 0 && <span className="muted">No comments yet.</span>}
            {comments.data?.map((c) => (
              <div key={c.id}>
                <div style={{ fontSize: 12 }} className="muted">
                  <strong style={{ color: 'var(--ink)' }}>{who(c.authorId)}</strong> · {new Date(c.createdAt).toLocaleString()}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{c.body}</div>
              </div>
            ))}
            {canComment && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim()) addComment.mutate();
                }}
                style={{ display: 'flex', gap: 6 }}
              >
                <label htmlFor="new-comment" className="sr-only">Comment</label>
                <input id="new-comment" className="input" placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
                <button type="submit" className="btn btn-primary" disabled={!comment.trim()}>
                  Send
                </button>
              </form>
            )}
          </div>
        )}

        {tab === 'history' && (
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.data?.map((h) => (
              <li key={h.id} style={{ fontSize: 13 }}>
                <span className="muted">{new Date(h.createdAt).toLocaleString()} · </span>
                <strong>{h.actorId ? who(h.actorId) : 'A form'}</strong>{' '}
                {h.action === 'update' ? `changed ${Object.keys(h.changes).map(fieldName).join(', ')}` : `${h.action}d this record`}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>,
    document.body,
  );
}
