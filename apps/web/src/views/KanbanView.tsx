import { type Choice, type Field, type RecordRow, type View, type ViewConfig } from '@tessera/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CellView } from '../components/CellView';
import { endpoints } from '../lib/api';
import { useModule } from '../lib/moduleContext';
import { orderedFields } from './GridView';

interface Props {
  view: View;
  records: RecordRow[];
  onOpenRecord: (id: string) => void;
  onChangeView: (patch: Partial<ViewConfig>) => void;
  canEdit: boolean;
}

/** Cards stacked by a single select or user field; drag a card to change it. */
export function KanbanView({ view, records, onOpenRecord, onChangeView, canEdit }: Props) {
  const qc = useQueryClient();
  const { schema, members } = useModule();
  const [over, setOver] = useState<string | null>(null);
  const stackable = schema.fields.filter((f) => f.type === 'singleSelect' || f.type === 'user');
  const stack = schema.fields.find((f) => f.id === view.config.stackFieldId) ?? stackable[0];

  const move = useMutation({
    mutationFn: ({ recordId, value }: { recordId: string; value: string | null }) => endpoints.updateRecord(recordId, { [stack!.id]: value }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['records', schema.module.id] }),
  });
  const add = useMutation({
    mutationFn: (value: string | null) => endpoints.createRecords(schema.module.id, [{ values: value ? { [stack!.id]: value } : {} }]),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['records', schema.module.id] });
      if (data.records[0]) onOpenRecord(data.records[0].id);
    },
  });

  if (!stack) {
    return <div className="empty">Add a single select or user field to stack records into columns.</div>;
  }

  const columns: { key: string | null; label: React.ReactNode }[] =
    stack.type === 'singleSelect'
      ? [{ key: null, label: 'Uncategorised' }, ...((stack.config.choices as Choice[]) ?? []).map((c) => ({ key: c.id, label: <CellView field={stack} value={c.id} /> }))]
      : [{ key: null, label: 'Unassigned' }, ...members.map((m) => ({ key: m.id, label: <CellView field={stack} value={m.id} /> }))];

  const cardFields = orderedFields(schema.fields, view.config).filter((f) => f.id !== stack.id && !f.isPrimary).slice(0, 4);
  const primary = schema.fields.find((f) => f.isPrimary) as Field;

  return (
    <div>
      <div style={{ padding: '12px 28px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <label htmlFor="stack-by" className="muted">Stacked by</label>
        <select id="stack-by" className="select" style={{ width: 200, height: 30 }} value={stack.id} onChange={(e) => onChangeView({ stackFieldId: e.target.value })}>
          {stackable.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="kanban">
        {columns.map((col) => {
          const cards = records.filter((r) => (r.values[stack.id] ?? null) === col.key);
          if (col.key === null && cards.length === 0) return null;
          const id = col.key ?? '__none';
          return (
            <section
              key={id}
              className={`kanban-col${over === id ? ' drop' : ''}`}
              aria-label={typeof col.label === 'string' ? col.label : undefined}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setOver(id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                const recordId = e.dataTransfer.getData('text/record');
                if (recordId) move.mutate({ recordId, value: col.key });
              }}
            >
              <div className="kanban-head">
                <span>{col.label}</span>
                <span className="muted">{cards.length}</span>
              </div>
              {cards.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="card"
                  draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData('text/record', r.id)}
                  onClick={() => onOpenRecord(r.id)}
                >
                  <span className="card-title">{String(r.values[primary.id] ?? '') || 'Unnamed record'}</span>
                  {cardFields.map((f) =>
                    r.values[f.id] === null || r.values[f.id] === undefined || (Array.isArray(r.values[f.id]) && (r.values[f.id] as unknown[]).length === 0) ? null : (
                      <span key={f.id} className="card-meta">
                        <span>{f.name}</span>
                        <CellView field={f} value={r.values[f.id]} />
                      </span>
                    ),
                  )}
                </button>
              ))}
              {canEdit && (
                <button type="button" className="add-row" style={{ borderRadius: 6 }} onClick={() => add.mutate(col.key)}>
                  + New record
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
