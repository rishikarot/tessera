import { cellToText, isComputed, type Field, type RecordRow, type View, type ViewConfig } from '@tessera/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState } from 'react';
import { CellView } from '../components/CellView';
import { FieldInput } from '../components/FieldInput';
import { Popover } from '../components/Overlay';
import { ApiError, endpoints } from '../lib/api';
import { FIELD_GLYPHS, NUMERIC_TYPES } from '../lib/fieldMeta';
import { useModule } from '../lib/moduleContext';

const INLINE_TYPES = new Set(['singleLineText', 'email', 'url', 'phone', 'number', 'currency', 'percent']);

export function orderedFields(fields: Field[], config: ViewConfig): Field[] {
  const hidden = new Set(config.hiddenFieldIds);
  const order = new Map(config.fieldOrder.map((id, i) => [id, i]));
  return fields
    .filter((f) => f.isPrimary || !hidden.has(f.id))
    .sort((a, b) => (a.isPrimary ? -1 : b.isPrimary ? 1 : (order.get(a.id) ?? 1e6 + a.position) - (order.get(b.id) ?? 1e6 + b.position)));
}

interface Props {
  view: View;
  records: RecordRow[];
  onOpenRecord: (id: string) => void;
  onEditField: (field: Field | null) => void;
  onChangeView: (patch: Partial<ViewConfig>) => void;
  canEdit: boolean;
  canEditSchema: boolean;
}

export function GridView({ view, records, onOpenRecord, onEditField, onChangeView, canEdit, canEditSchema }: Props) {
  const qc = useQueryClient();
  const { schema } = useModule();
  const fields = orderedFields(schema.fields, view.config);
  const [sel, setSel] = useState<{ row: number; col: number } | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number; anchor: HTMLElement } | null>(null);
  const [menu, setMenu] = useState<{ field: Field; anchor: HTMLElement } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);

  const save = useMutation({
    mutationFn: ({ recordId, fieldId, value }: { recordId: string; fieldId: string; value: unknown }) => endpoints.updateRecord(recordId, { [fieldId]: value }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['records', schema.module.id] });
    },
    onError: (e, { fieldId }) => setError(e instanceof ApiError ? e.details?.fields?.[fieldId] ?? e.message : 'Could not save'),
  });
  const add = useMutation({
    mutationFn: () => endpoints.createRecords(schema.module.id, [{ values: {} }]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records', schema.module.id] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add a record'),
  });
  const removeField = useMutation({
    mutationFn: (id: string) => endpoints.deleteField(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['module'] }),
  });

  const commit = (row: number, col: number, value: unknown) => {
    const rec = records[row];
    const field = fields[col];
    if (rec && field) save.mutate({ recordId: rec.id, fieldId: field.id, value });
  };

  const startEdit = (row: number, col: number, anchor: HTMLElement) => {
    const field = fields[col];
    if (!canEdit || !field || isComputed(field.type)) return;
    if (field.type === 'checkbox') return commit(row, col, !records[row]?.values[field.id]);
    setEditing({ row, col, anchor });
  };

  useEffect(() => {
    if (!sel || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role="dialog"]')) return;
      const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }[e.key];
      if (move) {
        e.preventDefault();
        setSel({ row: Math.max(0, Math.min(records.length - 1, sel.row + move[0]!)), col: Math.max(0, Math.min(fields.length - 1, sel.col + move[1]!)) });
      } else if (e.key === 'Enter') {
        const cell = table.current?.querySelector<HTMLElement>(`[data-cell="${sel.row}-${sel.col}"]`);
        if (cell) startEdit(sel.row, sel.col, cell);
        e.preventDefault();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && canEdit) {
        const f = fields[sel.col];
        if (f && !isComputed(f.type)) commit(sel.row, sel.col, f.type === 'checkbox' ? false : null);
      } else if (e.key === ' ' && records[sel.row]) {
        e.preventDefault();
        onOpenRecord(records[sel.row]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const groupField = view.config.groupBy[0] ? schema.fields.find((f) => f.id === view.config.groupBy[0]!.fieldId) : undefined;
  const groupLabel = (r: RecordRow) => (groupField ? cellToText(groupField, r.values[groupField.id]) || 'Empty' : '');
  const editingField = editing ? fields[editing.col] : undefined;
  const editingRecord = editing ? records[editing.row] : undefined;

  return (
    <>
      {error && (
        <div role="alert" className="error-text" style={{ padding: '8px 28px' }}>
          {error}
        </div>
      )}
      <table className="grid" ref={table} aria-label={`${schema.module.name}, ${view.name}`}>
        <thead>
          <tr>
            <th className="rownum" scope="col">
              <span className="sr-only">Row</span>
            </th>
            {fields.map((f) => (
              <th key={f.id} scope="col">
                <button type="button" className="col-head" title={f.description ?? undefined} onClick={(e) => setMenu({ field: f, anchor: e.currentTarget })}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', overflow: 'hidden' }}>
                    <span aria-hidden="true">{FIELD_GLYPHS[f.type]}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  </span>
                </button>
              </th>
            ))}
            <th scope="col" style={{ width: 44 }}>
              {canEditSchema && (
                <button type="button" className="col-head" aria-label="Add field" onClick={() => onEditField(null)} style={{ justifyContent: 'center' }}>
                  +
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, row) => (
            <Fragment key={r.id}>
              {groupField && (row === 0 || groupLabel(records[row - 1]!) !== groupLabel(r)) && (
                <tr>
                  <td colSpan={fields.length + 2} style={{ background: 'var(--bg-subtle)', padding: '10px 12px', fontSize: 12, color: 'var(--ink-3)' }}>
                    {groupField.name}: <strong style={{ color: 'var(--ink)' }}>{groupLabel(r)}</strong>
                  </td>
                </tr>
              )}
              <tr>
                <td className="rownum">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <span>{row + 1}</span>
                    <button type="button" className="btn btn-ghost icon-btn expand-btn" aria-label="Open record" onClick={() => onOpenRecord(r.id)} style={{ width: 20, height: 20, fontSize: 11 }}>
                      ↗
                    </button>
                  </div>
                </td>
                {fields.map((f, col) => {
                  const isSel = sel?.row === row && sel?.col === col;
                  const inline = editing?.row === row && editing?.col === col && INLINE_TYPES.has(f.type);
                  return (
                    <td key={f.id}>
                      {inline ? (
                        <InlineEditor
                          field={f}
                          value={r.values[f.id]}
                          onDone={(value, changed) => {
                            setEditing(null);
                            if (changed) commit(row, col, value);
                          }}
                        />
                      ) : (
                        <div
                          data-cell={`${row}-${col}`}
                          className={`cell${isSel ? ' selected' : ''}${NUMERIC_TYPES.has(f.type) ? ' num' : ''}`}
                          style={f.isPrimary ? { fontWeight: 500 } : undefined}
                          onClick={() => setSel({ row, col })}
                          onDoubleClick={(e) => startEdit(row, col, e.currentTarget)}
                        >
                          <CellView field={f} value={r.values[f.id]} />
                        </div>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            </Fragment>
          ))}
          {canEdit && (
            <tr>
              <td colSpan={fields.length + 2} style={{ borderRight: 0 }}>
                <button type="button" className="add-row" onClick={() => add.mutate()} disabled={add.isPending}>
                  + New record
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && editingField && editingRecord && !INLINE_TYPES.has(editingField.type) && (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)} width={320}>
          <div style={{ padding: 6 }}>
            <FieldInput
              autoFocus
              field={editingField}
              value={editingRecord.values[editingField.id]}
              onChange={(value) => {
                commit(editing.row, editing.col, value);
                if (['singleSelect', 'user', 'date', 'rating'].includes(editingField.type) && !editingField.config.allowMultiple) setEditing(null);
              }}
            />
          </div>
        </Popover>
      )}

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)}>
          {canEditSchema && (
            <button type="button" className="menu-item" onClick={() => (onEditField(menu.field), setMenu(null))}>
              Edit field
            </button>
          )}
          <button type="button" className="menu-item" onClick={() => (onChangeView({ sorts: [{ fieldId: menu.field.id, direction: 'asc' }] }), setMenu(null))}>
            Sort first to last
          </button>
          <button type="button" className="menu-item" onClick={() => (onChangeView({ sorts: [{ fieldId: menu.field.id, direction: 'desc' }] }), setMenu(null))}>
            Sort last to first
          </button>
          <button type="button" className="menu-item" onClick={() => (onChangeView({ groupBy: [{ fieldId: menu.field.id, direction: 'asc' }] }), setMenu(null))}>
            Group by this field
          </button>
          {!menu.field.isPrimary && (
            <button type="button" className="menu-item" onClick={() => (onChangeView({ hiddenFieldIds: [...view.config.hiddenFieldIds, menu.field.id] }), setMenu(null))}>
              Hide field
            </button>
          )}
          {canEditSchema && !menu.field.isPrimary && (
            <>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item btn-danger"
                onClick={() => {
                  if (confirm(`Delete the field "${menu.field.name}" and its data?`)) removeField.mutate(menu.field.id);
                  setMenu(null);
                }}
              >
                Delete field
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}

function InlineEditor({ field, value, onDone }: { field: Field; value: unknown; onDone: (value: unknown, changed: boolean) => void }) {
  const initial = value === null || value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const numeric = NUMERIC_TYPES.has(field.type);
  const finish = (save: boolean) => onDone(numeric ? (draft === '' ? null : Number(draft)) : draft, save && draft !== initial);
  return (
    <input
      autoFocus
      className="cell-editor"
      aria-label={field.name}
      type={numeric ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      style={{ height: 40, textAlign: numeric ? 'right' : 'left' }}
    />
  );
}
