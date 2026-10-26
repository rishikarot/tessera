import { cellToText, type Attachment, type Choice, type Field } from '@tessera/shared';
import { useModule } from '../lib/moduleContext';

export function ChoicePill({ choice }: { choice: Choice }) {
  return (
    <span className="pill" style={{ background: `var(--c-${choice.color}-bg)`, color: `var(--c-${choice.color}-ink)` }}>
      {choice.name}
    </span>
  );
}

export function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

function formatDate(value: string, withTime: boolean) {
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

/** Read-only rendering of one cell value. */
export function CellView({ field, value }: { field: Field; value: unknown }) {
  const { members, linkedNames, fieldById } = useModule();
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    if (field.type === 'button') {
      return (
        <span className="tag" title="Buttons run actions once automations arrive">
          {(field.config.label as string) || 'Open'}
        </span>
      );
    }
    return null;
  }

  switch (field.type) {
    case 'singleSelect':
    case 'multipleSelect': {
      const choices = (field.config.choices as Choice[]) ?? [];
      const ids = Array.isArray(value) ? value : [value];
      return (
        <>
          {ids.map((id) => {
            const c = choices.find((x) => x.id === id);
            return c ? <ChoicePill key={c.id} choice={c} /> : null;
          })}
        </>
      );
    }
    case 'checkbox':
      return value ? <span aria-label="Checked">✓</span> : null;
    case 'rating': {
      const max = (field.config.max as number) ?? 5;
      return (
        <span aria-label={`${value} of ${max}`} style={{ letterSpacing: 2, color: 'var(--ink-2)' }}>
          {'★'.repeat(value as number)}
          <span style={{ color: 'var(--line-strong)' }}>{'★'.repeat(max - (value as number))}</span>
        </span>
      );
    }
    case 'date':
      return <>{formatDate(String(value), Boolean(field.config.includeTime))}</>;
    case 'createdTime':
    case 'lastModifiedTime':
      return <>{formatDate(String(value), true)}</>;
    case 'user':
    case 'createdBy':
    case 'lastModifiedBy': {
      const ids = Array.isArray(value) ? value : [value];
      return (
        <>
          {ids.map((id) => {
            const m = members.find((x) => x.id === id);
            const name = m?.name ?? 'Unknown user';
            return (
              <span key={String(id)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="avatar" aria-hidden="true">
                  {initials(name)}
                </span>
                {name}
              </span>
            );
          })}
        </>
      );
    }
    case 'linkedRecord':
      return (
        <>
          {(value as string[]).map((id) => (
            <span key={id} className="tag">
              {linkedNames[id] || 'Unnamed record'}
            </span>
          ))}
        </>
      );
    case 'lookup': {
      const source = fieldById(field.config.targetFieldId as string);
      const items = value as unknown[];
      if (!source) return <>{items.map(String).join(', ')}</>;
      return (
        <>
          {items.map((v, i) => (
            <span key={i} className={source.type === 'singleSelect' || source.type === 'multipleSelect' ? undefined : 'tag'}>
              <CellView field={source} value={v} />
            </span>
          ))}
        </>
      );
    }
    case 'rollup': {
      const source = fieldById(field.config.targetFieldId as string);
      if (Array.isArray(value)) return <>{value.map((v) => (source ? cellToText(source, v) : String(v))).join(', ')}</>;
      return <>{source && typeof value === 'number' ? cellToText(source, Math.round(value * 100) / 100) : String(value)}</>;
    }
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      );
    case 'email':
      return <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()}>{String(value)}</a>;
    case 'phone':
      return <a href={`tel:${value}`} onClick={(e) => e.stopPropagation()}>{String(value)}</a>;
    case 'attachment':
      return (
        <>
          {(value as Attachment[]).map((a) => (
            <a key={a.id} className="tag" href={a.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
              {a.name}
            </a>
          ))}
        </>
      );
    case 'signature':
      return <img src={String(value)} alt="Signature" style={{ height: 28 }} />;
    default:
      return <>{cellToText(field, value)}</>;
  }
}
