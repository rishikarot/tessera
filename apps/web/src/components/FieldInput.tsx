import { isComputed, type Attachment, type Choice, type Field } from '@tessera/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { endpoints } from '../lib/api';
import { COMING_LATER } from '../lib/fieldMeta';
import { useModule } from '../lib/moduleContext';
import { CellView, ChoicePill } from './CellView';

interface Props {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  autoFocus?: boolean;
  /** Text inputs report on every keystroke when true, otherwise on blur or Enter. */
  live?: boolean;
  id?: string;
}

function toDuration(seconds: unknown): string {
  if (typeof seconds !== 'number') return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fromDuration(text: string): number | null {
  if (!text.trim()) return null;
  const parts = text.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  const [h = 0, m = 0, s = 0] = parts;
  return h * 3600 + m * 60 + s;
}

/** A text-like input that keeps a draft and commits on blur or Enter. */
function DraftInput({ value, onCommit, type = 'text', autoFocus, live, id, multiline }: { value: string; onCommit: (v: string) => void; type?: string; autoFocus?: boolean; live?: boolean; id?: string; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  const common = {
    id,
    autoFocus,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      if (live) onCommit(e.target.value);
    },
    onBlur: live ? undefined : commit,
  };
  if (multiline) return <textarea className="textarea" {...common} />;
  return <input className="input" type={type} {...common} onKeyDown={(e) => e.key === 'Enter' && !live && commit()} />;
}

function LinkPicker({ field, value, onChange }: { field: Field; value: string[]; onChange: (v: string[]) => void }) {
  const { linkedNames } = useModule();
  const [search, setSearch] = useState('');
  const targetId = field.config.targetModuleId as string;
  const target = useQuery({ queryKey: ['module', targetId], queryFn: () => endpoints.module(targetId) });
  const results = useQuery({
    queryKey: ['records', targetId, 'picker', search],
    queryFn: () => endpoints.records(targetId, { search, limit: 20 }),
  });
  const primary = target.data?.fields.find((f) => f.isPrimary);
  const multiple = field.config.allowMultiple !== false;
  const names = { ...linkedNames };
  for (const r of results.data?.records ?? []) names[r.id] = primary ? String(r.values[primary.id] ?? '') : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {value.map((id) => (
          <span key={id} className="tag" style={{ gap: 6 }}>
            {names[id] || 'Unnamed record'}
            <button type="button" className="btn-ghost" style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }} aria-label="Remove link" onClick={() => onChange(value.filter((v) => v !== id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input className="input" placeholder={`Find a record in ${target.data?.module.name ?? 'the linked module'}`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a record to link" />
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {(results.data?.records ?? [])
          .filter((r) => !value.includes(r.id))
          .map((r) => (
            <button key={r.id} type="button" className="menu-item" onClick={() => onChange(multiple ? [...value, r.id] : [r.id])}>
              {names[r.id] || 'Unnamed record'}
            </button>
          ))}
      </div>
    </div>
  );
}

function AttachmentInput({ value, onChange }: { value: Attachment[]; onChange: (v: Attachment[]) => void }) {
  const [url, setUrl] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((a) => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <a href={a.url} target="_blank" rel="noreferrer noopener">
            {a.name}
          </a>
          <button type="button" className="btn btn-ghost icon-btn" aria-label={`Remove ${a.name}`} onClick={() => onChange(value.filter((x) => x.id !== a.id))}>
            ×
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input" placeholder="Paste a file link" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="File link" />
        <button
          type="button"
          className="btn"
          disabled={!url.trim()}
          onClick={() => {
            const name = decodeURIComponent(url.split('/').pop() || 'file');
            onChange([...value, { id: crypto.randomUUID(), url: url.trim(), name }]);
            setUrl('');
          }}
        >
          Add
        </button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        File uploads arrive with storage in Phase 2; links work today.
      </span>
    </div>
  );
}

/** Editor for one cell, used by the grid, the record panel and forms. */
export function FieldInput({ field, value, onChange, autoFocus, live, id }: Props) {
  const { members } = useModule();
  if (isComputed(field.type)) {
    return (
      <div className="muted" style={{ minHeight: 34, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <CellView field={field} value={value} />
        {COMING_LATER[field.type] && <span style={{ fontSize: 12 }}>{COMING_LATER[field.type]}</span>}
      </div>
    );
  }

  switch (field.type) {
    case 'singleLineText':
    case 'email':
    case 'url':
    case 'phone':
      return <DraftInput id={id} autoFocus={autoFocus} live={live} type={{ email: 'email', url: 'url', phone: 'tel' }[field.type as string] ?? 'text'} value={String(value ?? '')} onCommit={onChange} />;
    case 'longText':
      return <DraftInput id={id} autoFocus={autoFocus} live={live} multiline value={String(value ?? '')} onCommit={onChange} />;
    case 'number':
    case 'currency':
    case 'percent':
      return <DraftInput id={id} autoFocus={autoFocus} live={live} type="number" value={value === null || value === undefined ? '' : String(value)} onCommit={(v) => onChange(v === '' ? null : Number(v))} />;
    case 'duration':
      return <DraftInput id={id} autoFocus={autoFocus} live={live} value={toDuration(value)} onCommit={(v) => onChange(fromDuration(v))} />;
    case 'barcode':
      return <DraftInput id={id} autoFocus={autoFocus} live={live} value={String((value as { text?: string } | null)?.text ?? '')} onCommit={(v) => onChange(v ? { text: v } : null)} />;
    case 'date': {
      const withTime = Boolean(field.config.includeTime);
      const shown = typeof value === 'string' ? (withTime ? new Date(value).toISOString().slice(0, 16) : value) : '';
      return (
        <input
          id={id}
          autoFocus={autoFocus}
          className="input"
          type={withTime ? 'datetime-local' : 'date'}
          value={shown}
          onChange={(e) => onChange(e.target.value ? (withTime ? new Date(e.target.value).toISOString() : e.target.value) : null)}
        />
      );
    }
    case 'checkbox':
      return <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />;
    case 'rating': {
      const max = (field.config.max as number) ?? 5;
      const current = (value as number) ?? 0;
      return (
        <div role="radiogroup" aria-label={field.name} style={{ display: 'flex', gap: 2 }}>
          {Array.from({ length: max }, (_, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={current === i + 1}
              aria-label={`${i + 1} of ${max}`}
              onClick={() => onChange(current === i + 1 ? 0 : i + 1)}
              style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 18, padding: 2, color: i < current ? 'var(--ink-2)' : 'var(--line-strong)' }}
            >
              ★
            </button>
          ))}
        </div>
      );
    }
    case 'singleSelect': {
      const choices = (field.config.choices as Choice[]) ?? [];
      return (
        <select id={id} autoFocus={autoFocus} className="select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">No option</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
    }
    case 'multipleSelect': {
      const choices = (field.config.choices as Choice[]) ?? [];
      const selected = (value as string[]) ?? [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {choices.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => onChange(e.target.checked ? [...selected, c.id] : selected.filter((s) => s !== c.id))} />
              <ChoicePill choice={c} />
            </label>
          ))}
          {choices.length === 0 && <span className="muted">Add options in the field settings.</span>}
        </div>
      );
    }
    case 'user': {
      if (field.config.allowMultiple) {
        const selected = (value as string[]) ?? [];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.map((m) => (
              <label key={m.id} className="check">
                <input type="checkbox" checked={selected.includes(m.id)} onChange={(e) => onChange(e.target.checked ? [...selected, m.id] : selected.filter((s) => s !== m.id))} />
                {m.name}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select id={id} autoFocus={autoFocus} className="select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Nobody</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      );
    }
    case 'linkedRecord':
      return <LinkPicker field={field} value={(value as string[]) ?? []} onChange={onChange} />;
    case 'attachment':
      return <AttachmentInput value={(value as Attachment[]) ?? []} onChange={onChange} />;
    case 'location': {
      const loc = (value as { lat: number; lng: number; address?: string } | null) ?? null;
      const set = (patch: Partial<{ lat: number; lng: number; address: string }>) => {
        const next = { lat: loc?.lat ?? 0, lng: loc?.lng ?? 0, address: loc?.address, ...patch };
        onChange(next);
      };
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <input className="input" style={{ gridColumn: '1 / -1' }} placeholder="Address" defaultValue={loc?.address ?? ''} onBlur={(e) => set({ address: e.target.value })} aria-label="Address" />
          <input className="input" type="number" placeholder="Latitude" defaultValue={loc?.lat ?? ''} onBlur={(e) => set({ lat: Number(e.target.value) })} aria-label="Latitude" />
          <input className="input" type="number" placeholder="Longitude" defaultValue={loc?.lng ?? ''} onBlur={(e) => set({ lng: Number(e.target.value) })} aria-label="Longitude" />
        </div>
      );
    }
    case 'signature':
      return <SignaturePad value={value as string | null} onChange={onChange} />;
    default:
      return <span className="muted">Not editable</span>;
  }
}

function SignaturePad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  if (value) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <img src={value} alt="Signature" style={{ height: 60, border: '1px solid var(--line)', borderRadius: 6 }} />
        <button type="button" className="btn" onClick={() => onChange(null)}>
          Clear
        </button>
      </div>
    );
  }
  return (
    <canvas
      ref={canvas}
      width={360}
      height={120}
      aria-label="Sign here"
      style={{ border: '1px dashed var(--line-strong)', borderRadius: 6, touchAction: 'none', maxWidth: '100%' }}
      onPointerDown={(e) => {
        drawing.current = true;
        const ctx = e.currentTarget.getContext('2d')!;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#111';
        ctx.beginPath();
        ctx.moveTo(...point(e));
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const ctx = e.currentTarget.getContext('2d')!;
        ctx.lineTo(...point(e));
        ctx.stroke();
      }}
      onPointerUp={() => {
        drawing.current = false;
        onChange(canvas.current!.toDataURL('image/png'));
      }}
    />
  );
}
