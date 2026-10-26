import { operatorsFor, type Choice, type Field, type FilterCondition, type FilterOperator, type View, type ViewConfig } from '@tessera/shared';
import { useState } from 'react';
import { FIELD_GLYPHS } from '../lib/fieldMeta';
import { useModule } from '../lib/moduleContext';
import { Popover } from './Overlay';

const OP_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  doesNotContain: 'does not contain',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  isAnyOf: 'is any of',
  isNoneOf: 'is none of',
  hasAnyOf: 'has any of',
  hasAllOf: 'has all of',
  isBefore: 'is before',
  isAfter: 'is after',
};

function ConditionValue({ field, condition, onChange }: { field: Field; condition: FilterCondition; onChange: (v: unknown) => void }) {
  const { members } = useModule();
  if (condition.operator === 'isEmpty' || condition.operator === 'isNotEmpty') return null;
  const multi = ['isAnyOf', 'isNoneOf', 'hasAnyOf', 'hasAllOf'].includes(condition.operator);
  if (field.type === 'singleSelect' || field.type === 'multipleSelect') {
    const choices = (field.config.choices as Choice[]) ?? [];
    if (multi) {
      const selected = (condition.value as string[]) ?? [];
      return (
        <select className="select" multiple value={selected} aria-label="Values" style={{ height: 'auto', minHeight: 34 }} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      );
    }
    return (
      <select className="select" value={String(condition.value ?? '')} aria-label="Value" onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'user' || field.type === 'createdBy' || field.type === 'lastModifiedBy') {
    return (
      <select className="select" value={String(condition.value ?? '')} aria-label="Value" onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose</option>
        <option value="@me">Me</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <select className="select" value={String(Boolean(condition.value))} aria-label="Value" onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    );
  }
  const isDate = field.type === 'date' || field.type === 'createdTime' || field.type === 'lastModifiedTime';
  const isNum = ['gt', 'gte', 'lt', 'lte'].includes(condition.operator) || ['number', 'currency', 'percent', 'rating', 'autoNumber', 'count', 'duration'].includes(field.type);
  return (
    <input
      className="input"
      type={isDate ? 'date' : isNum ? 'number' : 'text'}
      aria-label="Value"
      value={String(condition.value ?? '')}
      onChange={(e) => onChange(isNum && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
    />
  );
}

function FilterEditor({ fields, config, onChange }: { fields: Field[]; config: ViewConfig; onChange: (p: Partial<ViewConfig>) => void }) {
  const { filter } = config;
  const setConditions = (conditions: FilterCondition[]) => onChange({ filter: { ...filter, conditions } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
      {filter.conditions.length === 0 && <span className="muted">No filters. Records are not hidden.</span>}
      {filter.conditions.map((c, i) => {
        const field = fields.find((f) => f.id === c.fieldId);
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr 1.2fr 28px', gap: 6, alignItems: 'center' }}>
            {i === 0 ? (
              <span className="muted">Where</span>
            ) : i === 1 ? (
              <select className="select" aria-label="Match" value={filter.conjunction} onChange={(e) => onChange({ filter: { ...filter, conjunction: e.target.value as 'and' | 'or' } })}>
                <option value="and">and</option>
                <option value="or">or</option>
              </select>
            ) : (
              <span className="muted">{filter.conjunction}</span>
            )}
            <select
              className="select"
              aria-label="Field"
              value={c.fieldId}
              onChange={(e) => {
                const f = fields.find((x) => x.id === e.target.value)!;
                setConditions(filter.conditions.map((x, j) => (j === i ? { fieldId: f.id, operator: operatorsFor(f.type)[0]!, value: undefined } : x)));
              }}
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <select className="select" aria-label="Operator" value={c.operator} onChange={(e) => setConditions(filter.conditions.map((x, j) => (j === i ? { ...x, operator: e.target.value as FilterOperator } : x)))}>
              {(field ? operatorsFor(field.type) : []).map((op) => (
                <option key={op} value={op}>{OP_LABELS[op]}</option>
              ))}
            </select>
            {field ? <ConditionValue field={field} condition={c} onChange={(value) => setConditions(filter.conditions.map((x, j) => (j === i ? { ...x, value } : x)))} /> : <span />}
            <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove filter" onClick={() => setConditions(filter.conditions.filter((_, j) => j !== i))}>×</button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn btn-ghost"
        style={{ alignSelf: 'flex-start' }}
        disabled={fields.length === 0}
        onClick={() => setConditions([...filter.conditions, { fieldId: fields[0]!.id, operator: operatorsFor(fields[0]!.type)[0]!, value: undefined }])}
      >
        + Add condition
      </button>
    </div>
  );
}

function SortEditor({ fields, config, onChange, kind }: { fields: Field[]; config: ViewConfig; onChange: (p: Partial<ViewConfig>) => void; kind: 'sorts' | 'groupBy' }) {
  const list = config[kind];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
      {list.length === 0 && <span className="muted">{kind === 'sorts' ? 'Records keep the order they were added.' : 'Records are not grouped.'}</span>}
      {list.map((s, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 28px', gap: 6 }}>
          <select className="select" aria-label="Field" value={s.fieldId} onChange={(e) => onChange({ [kind]: list.map((x, j) => (j === i ? { ...x, fieldId: e.target.value } : x)) })}>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <select className="select" aria-label="Direction" value={s.direction} onChange={(e) => onChange({ [kind]: list.map((x, j) => (j === i ? { ...x, direction: e.target.value as 'asc' | 'desc' } : x)) })}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove" onClick={() => onChange({ [kind]: list.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={fields.length === 0} onClick={() => onChange({ [kind]: [...list, { fieldId: fields[0]!.id, direction: 'asc' }] })}>
        + Add {kind === 'sorts' ? 'sort' : 'group'}
      </button>
    </div>
  );
}

function HideEditor({ fields, config, onChange }: { fields: Field[]; config: ViewConfig; onChange: (p: Partial<ViewConfig>) => void }) {
  const hidden = new Set(config.hiddenFieldIds);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 4, maxHeight: 360, overflowY: 'auto' }}>
      {fields.map((f) => (
        <label key={f.id} className="menu-item">
          <input
            type="checkbox"
            disabled={f.isPrimary}
            checked={!hidden.has(f.id)}
            onChange={(e) => onChange({ hiddenFieldIds: e.target.checked ? config.hiddenFieldIds.filter((id) => id !== f.id) : [...config.hiddenFieldIds, f.id] })}
          />
          <span className="muted" style={{ width: 18 }}>{FIELD_GLYPHS[f.type]}</span>
          {f.name}
        </label>
      ))}
    </div>
  );
}

type Panel = 'filter' | 'sort' | 'group' | 'hide';

export function ViewToolbar({ view, fields, onChange, search, onSearch, canEdit }: { view: View; fields: Field[]; onChange: (p: Partial<ViewConfig>) => void; search: string; onSearch: (s: string) => void; canEdit: boolean }) {
  const [open, setOpen] = useState<{ panel: Panel; anchor: HTMLElement } | null>(null);
  const c = view.config;
  const complete = c.filter.conditions.filter((x) => x.operator === 'isEmpty' || x.operator === 'isNotEmpty' || !(x.value === undefined || x.value === '' || (Array.isArray(x.value) && x.value.length === 0)));
  const count = { filter: complete.length, sort: c.sorts.length, group: c.groupBy.length, hide: c.hiddenFieldIds.length };
  const label: Record<Panel, string> = {
    filter: count.filter ? `Filtered by ${count.filter}` : 'Filter',
    sort: count.sort ? `Sorted by ${count.sort}` : 'Sort',
    group: count.group ? `Grouped by ${count.group}` : 'Group',
    hide: count.hide ? `${count.hide} hidden` : 'Fields',
  };
  const panels: Panel[] = view.type === 'form' ? [] : view.type === 'kanban' ? ['filter', 'sort', 'hide'] : ['filter', 'sort', 'group', 'hide'];
  return (
    <div className="toolbar-group">
      {panels.map((p) => (
        <button
          key={p}
          type="button"
          className={`btn btn-ghost${count[p] ? ' active' : ''}`}
          aria-expanded={open?.panel === p}
          disabled={!canEdit}
          title={canEdit ? undefined : 'This view is locked'}
          onClick={(e) => setOpen(open?.panel === p ? null : { panel: p, anchor: e.currentTarget })}
        >
          {label[p]}
        </button>
      ))}
      {view.type !== 'form' && (
        <>
          <label htmlFor="record-search" className="sr-only">Search records</label>
          <input id="record-search" className="input" type="search" placeholder="Search" value={search} onChange={(e) => onSearch(e.target.value)} style={{ width: 180, height: 32 }} />
        </>
      )}
      {open && (
        <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={open.panel === 'filter' ? 560 : 340}>
          {open.panel === 'filter' && <FilterEditor fields={fields} config={c} onChange={onChange} />}
          {open.panel === 'sort' && <SortEditor fields={fields} config={c} onChange={onChange} kind="sorts" />}
          {open.panel === 'group' && <SortEditor fields={fields} config={c} onChange={onChange} kind="groupBy" />}
          {open.panel === 'hide' && <HideEditor fields={fields} config={c} onChange={onChange} />}
        </Popover>
      )}
    </div>
  );
}
