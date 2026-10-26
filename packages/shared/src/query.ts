import type { Choice, Field } from './fields.js';
import type { Filter, FilterCondition, Sort } from './views.js';

/** Minimal record shape needed to filter and sort. */
export interface QueryableRecord {
  id: string;
  values: Record<string, unknown>;
}

export interface QueryContext {
  /** The signed-in user, for "is me" style filters. */
  userId?: string | null;
  /** ISO date (YYYY-MM-DD) used when a filter value is "today". */
  today?: string;
}

const NO_VALUE_OPERATORS = new Set(['isEmpty', 'isNotEmpty']);

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0);
}

function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(text).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.address === 'string') return o.address;
    return '';
  }
  return String(v);
}

function asArray(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function toTime(v: unknown, ctx: QueryContext): number {
  if (v === 'today') return Date.parse(ctx.today ?? new Date().toISOString().slice(0, 10));
  return typeof v === 'string' ? Date.parse(v) : NaN;
}

function dayOf(v: unknown, ctx: QueryContext): string {
  if (v === 'today') return ctx.today ?? new Date().toISOString().slice(0, 10);
  return typeof v === 'string' ? v.slice(0, 10) : '';
}

function resolveValue(cond: unknown, ctx: QueryContext): unknown {
  if (cond === '@me') return ctx.userId ?? null;
  if (Array.isArray(cond)) return cond.map((c) => (c === '@me' ? ctx.userId ?? null : c));
  return cond;
}

export function matchesCondition(field: Field, cell: unknown, condition: FilterCondition, ctx: QueryContext = {}): boolean {
  const op = condition.operator;
  if (op === 'isEmpty') return isEmptyValue(cell);
  if (op === 'isNotEmpty') return !isEmptyValue(cell);
  const want = resolveValue(condition.value, ctx);
  const isDate = field.type === 'date' || field.type === 'createdTime' || field.type === 'lastModifiedTime';

  switch (op) {
    case 'is':
      if (field.type === 'checkbox') return Boolean(cell) === Boolean(want);
      if (isDate) return dayOf(cell, ctx) === dayOf(want, ctx);
      if (typeof cell === 'number') return cell === Number(want);
      return text(cell).toLowerCase() === text(want).toLowerCase();
    case 'isNot':
      if (isDate) return dayOf(cell, ctx) !== dayOf(want, ctx);
      if (typeof cell === 'number') return cell !== Number(want);
      return text(cell).toLowerCase() !== text(want).toLowerCase();
    case 'contains':
      return text(cell).toLowerCase().includes(text(want).toLowerCase());
    case 'doesNotContain':
      return !text(cell).toLowerCase().includes(text(want).toLowerCase());
    case 'gt':
      return typeof cell === 'number' && cell > Number(want);
    case 'gte':
      return typeof cell === 'number' && cell >= Number(want);
    case 'lt':
      return typeof cell === 'number' && cell < Number(want);
    case 'lte':
      return typeof cell === 'number' && cell <= Number(want);
    case 'isAnyOf':
      return asArray(want).some((w) => asArray(cell).includes(w));
    case 'isNoneOf':
      return !asArray(want).some((w) => asArray(cell).includes(w));
    case 'hasAnyOf':
      return asArray(want).some((w) => asArray(cell).includes(w));
    case 'hasAllOf':
      return asArray(want).every((w) => asArray(cell).includes(w));
    case 'isBefore':
      return toTime(cell, ctx) < toTime(want, ctx);
    case 'isAfter':
      return toTime(cell, ctx) > toTime(want, ctx);
    default:
      return true;
  }
}

/** Conditions missing a value are ignored, as in Airtable's filter builder. */
function isComplete(c: FilterCondition): boolean {
  if (NO_VALUE_OPERATORS.has(c.operator)) return true;
  return !(c.value === undefined || c.value === null || c.value === '' || (Array.isArray(c.value) && c.value.length === 0));
}

export function matchesFilter(record: QueryableRecord, fields: Map<string, Field>, filter: Filter, ctx: QueryContext = {}): boolean {
  const conditions = filter.conditions.filter((c) => fields.has(c.fieldId) && isComplete(c));
  if (conditions.length === 0) return true;
  const test = (c: FilterCondition) => matchesCondition(fields.get(c.fieldId)!, record.values[c.fieldId], c, ctx);
  return filter.conjunction === 'or' ? conditions.some(test) : conditions.every(test);
}

/** A sortable key for a cell; select fields sort by option order, not name. */
function sortKey(field: Field, v: unknown): number | string | null {
  if (isEmptyValue(v) && field.type !== 'checkbox') return null;
  switch (field.type) {
    case 'singleSelect': {
      const choices = (field.config.choices as Choice[] | undefined) ?? [];
      return choices.findIndex((c) => c.id === v);
    }
    case 'checkbox':
      return v ? 1 : 0;
    case 'number':
    case 'currency':
    case 'percent':
    case 'duration':
    case 'rating':
    case 'autoNumber':
    case 'count':
      return typeof v === 'number' ? v : Number(v);
    case 'rollup':
      return typeof v === 'number' ? v : text(v).toLowerCase();
    case 'date':
    case 'createdTime':
    case 'lastModifiedTime':
      return typeof v === 'string' ? Date.parse(v) : null;
    default:
      return text(v).toLowerCase();
  }
}

export function compareCells(field: Field, a: unknown, b: unknown): number {
  const ka = sortKey(field, a);
  const kb = sortKey(field, b);
  // Empty cells always sort last, whatever the direction.
  if (ka === null && kb === null) return 0;
  if (ka === null) return 1;
  if (kb === null) return -1;
  if (typeof ka === 'number' && typeof kb === 'number') return ka - kb;
  return String(ka).localeCompare(String(kb), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortRecords<T extends QueryableRecord>(records: T[], fields: Map<string, Field>, sorts: Sort[]): T[] {
  const active = sorts.filter((s) => fields.has(s.fieldId));
  if (active.length === 0) return records;
  return [...records].sort((ra, rb) => {
    for (const s of active) {
      const field = fields.get(s.fieldId)!;
      const a = ra.values[s.fieldId];
      const b = rb.values[s.fieldId];
      const base = compareCells(field, a, b);
      if (base === 0) continue;
      const aEmpty = sortKey(field, a) === null;
      const bEmpty = sortKey(field, b) === null;
      return aEmpty || bEmpty ? base : s.direction === 'desc' ? -base : base;
    }
    return 0;
  });
}

export function searchRecords<T extends QueryableRecord>(records: T[], fields: Field[], query: string | undefined): T[] {
  const q = query?.trim().toLowerCase();
  if (!q) return records;
  const choiceNames = new Map<string, string>();
  for (const f of fields) for (const c of (f.config.choices as Choice[] | undefined) ?? []) choiceNames.set(c.id, c.name);
  return records.filter((r) =>
    fields.some((f) => {
      const v = r.values[f.id];
      const shown = f.type === 'singleSelect' || f.type === 'multipleSelect' ? asArray(v).map((id) => choiceNames.get(String(id)) ?? '').join(' ') : text(v);
      return shown.toLowerCase().includes(q);
    }),
  );
}
