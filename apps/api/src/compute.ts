import { cellToText, isEmptyValue, type Field, type RecordRow } from '@tessera/shared';
import type { Db } from './db.js';
import { loadFields } from './schema-service.js';

type Row = Record<string, any>;

/** Lookups of lookups resolve this many modules deep. */
const MAX_DEPTH = 3;

export interface ComputedRecords {
  records: RecordRow[];
  /** Display names of every record referenced by a linked-record field. */
  linkedNames: Record<string, string>;
}

function aggregate(kind: string, values: unknown[]): unknown {
  const flat = values.flat().filter((v) => !isEmptyValue(v));
  const nums = flat.filter((v): v is number => typeof v === 'number');
  switch (kind) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'min':
      return nums.length ? Math.min(...nums) : null;
    case 'max':
      return nums.length ? Math.max(...nums) : null;
    case 'count':
      return flat.length;
    case 'countAll':
      return values.length;
    case 'arrayUnique':
      return [...new Set(flat.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)))];
    case 'arrayJoin':
    default:
      return flat;
  }
}

/**
 * Turns stored rows into records with every computed field filled in:
 * system fields, linked records, lookups, rollups and counts. Formula and AI
 * fields come in a later phase and are returned empty for now.
 */
export async function computeRecords(db: Db, moduleId: string, rows: Row[], fields?: Field[], depth = 0): Promise<ComputedRecords> {
  const fieldList = fields ?? (await loadFields(db, moduleId));
  const records: RecordRow[] = rows.map((r) => ({
    id: r.id,
    moduleId: r.module_id,
    values: { ...(r.values ?? {}) },
    autoNumber: r.auto_number,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    createdBy: r.created_by,
    updatedBy: r.updated_by,
  }));
  const linkedNames: Record<string, string> = {};
  if (records.length === 0) return { records, linkedNames };

  for (const rec of records) {
    for (const f of fieldList) {
      switch (f.type) {
        case 'autoNumber':
          rec.values[f.id] = rec.autoNumber;
          break;
        case 'createdTime':
          rec.values[f.id] = rec.createdAt;
          break;
        case 'lastModifiedTime':
          rec.values[f.id] = rec.updatedAt;
          break;
        case 'createdBy':
          rec.values[f.id] = rec.createdBy;
          break;
        case 'lastModifiedBy':
          rec.values[f.id] = rec.updatedBy;
          break;
        case 'formula':
        case 'ai':
        case 'button':
          rec.values[f.id] = null;
          break;
      }
    }
  }

  const linkFields = fieldList.filter((f) => f.type === 'linkedRecord');
  if (linkFields.length === 0) return { records, linkedNames };

  // Linked record ids, in the order the user arranged them.
  const ids = records.map((r) => r.id);
  const links = await db`
    select l.field_id, l.from_record, l.to_record from record_links l
    join records t on t.id = l.to_record and t.deleted_at is null
    where l.field_id in ${db(linkFields.map((f) => f.id))} and l.from_record in ${db(ids)}
    order by l.position, l.to_record`;
  const byRecord = new Map(records.map((r) => [r.id, r]));
  for (const rec of records) for (const f of linkFields) rec.values[f.id] = [];
  for (const l of links) (byRecord.get(l.from_record)!.values[l.field_id] as string[]).push(l.to_record);

  // Load and compute the linked records once per target module.
  const targets = new Map<string, { recs: Map<string, RecordRow>; fields: Field[] }>();
  if (depth < MAX_DEPTH) {
    for (const lf of linkFields) {
      const targetId = lf.config.targetModuleId as string;
      if (targets.has(targetId)) continue;
      const targetIds = [...new Set(links.filter((l) => linkFields.some((f) => f.id === l.field_id && f.config.targetModuleId === targetId)).map((l) => l.to_record))];
      const tFields = targetId === moduleId ? fieldList : await loadFields(db, targetId);
      const tRows = targetIds.length ? await db`select * from records where id in ${db(targetIds)} and deleted_at is null` : [];
      const computed = await computeRecords(db, targetId, tRows, tFields, depth + 1);
      targets.set(targetId, { recs: new Map(computed.records.map((r) => [r.id, r])), fields: tFields });
      const primary = tFields.find((f) => f.isPrimary);
      for (const r of computed.records) linkedNames[r.id] = primary ? cellToText(primary, r.values[primary.id]) : '';
    }
  }

  for (const f of fieldList) {
    if (f.type !== 'lookup' && f.type !== 'rollup' && f.type !== 'count') continue;
    const link = linkFields.find((l) => l.id === f.config.linkFieldId);
    for (const rec of records) {
      const linked = link ? ((rec.values[link.id] as string[]) ?? []) : [];
      if (f.type === 'count') {
        rec.values[f.id] = linked.length;
        continue;
      }
      const target = link ? targets.get(link.config.targetModuleId as string) : undefined;
      const sourceValues = target ? linked.map((id) => target.recs.get(id)?.values[f.config.targetFieldId as string]).filter((v) => v !== undefined) : [];
      rec.values[f.id] = f.type === 'lookup' ? sourceValues.flat().filter((v) => !isEmptyValue(v)) : aggregate(String(f.config.aggregate), sourceValues);
    }
  }
  return { records, linkedNames };
}
