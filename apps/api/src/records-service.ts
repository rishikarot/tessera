import {
  isEmptyValue,
  matchesFilter,
  searchRecords,
  sortRecords,
  validateValue,
  viewConfigSchema,
  type Field,
  type RecordRow,
  type listRecordsQuery,
} from '@tessera/shared';
import type { z } from 'zod';
import { computeRecords } from './compute.js';
import type { Db, Sql, Tx } from './db.js';
import { badRequest, notFound } from './errors.js';
import { loadFields } from './schema-service.js';

/** Upper bound on records filtered in memory per request until SQL push-down lands. */
const SCAN_LIMIT = 50_000;

interface Split {
  stored: Record<string, unknown>;
  cleared: string[];
  links: Map<Field, string[]>;
}

/** Validates a patch of cell values against the module's fields. */
function splitValues(fields: Field[], values: Record<string, unknown>): Split {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const out: Split = { stored: {}, cleared: [], links: new Map() };
  const errors: Record<string, string> = {};
  for (const [fieldId, raw] of Object.entries(values)) {
    const field = byId.get(fieldId);
    if (!field) {
      errors[fieldId] = 'Unknown field';
      continue;
    }
    const res = validateValue(field, raw);
    if (!res.ok) {
      errors[fieldId] = res.error;
      continue;
    }
    if (field.type === 'linkedRecord') out.links.set(field, (res.value as string[] | null) ?? []);
    else if (isEmptyValue(res.value) && field.type !== 'checkbox') out.cleared.push(fieldId);
    else out.stored[fieldId] = res.value;
  }
  if (Object.keys(errors).length) throw badRequest('Some values are not valid', { fields: errors });
  return out;
}

function checkRequired(fields: Field[], values: Record<string, unknown>, links: Map<Field, string[]>) {
  const missing = fields.filter((f) => f.required && (f.type === 'linkedRecord' ? !(links.get(f)?.length) : isEmptyValue(values[f.id])));
  if (missing.length) {
    throw badRequest('Some required fields are empty', { fields: Object.fromEntries(missing.map((f) => [f.id, 'Required'])) });
  }
}

async function setLinks(tx: Tx, field: Field, recordId: string, targetIds: string[]) {
  const targetModuleId = field.config.targetModuleId as string;
  if (targetIds.length) {
    const found = await tx`select id from records where id in ${tx(targetIds)} and module_id = ${targetModuleId} and deleted_at is null`;
    if (found.length !== targetIds.length) throw badRequest(`"${field.name}" points at records that do not exist`);
  }
  const before = (await tx`select to_record from record_links where field_id = ${field.id} and from_record = ${recordId}`).map((r) => r.to_record as string);
  await tx`delete from record_links where field_id = ${field.id} and from_record = ${recordId}`;
  for (const [i, to] of targetIds.entries()) {
    await tx`insert into record_links (field_id, from_record, to_record, position) values (${field.id}, ${recordId}, ${to}, ${i})`;
  }

  const inverseId = field.config.inverseFieldId as string | null;
  if (!inverseId) return;
  const removed = before.filter((id) => !targetIds.includes(id));
  const added = targetIds.filter((id) => !before.includes(id));
  if (removed.length) await tx`delete from record_links where field_id = ${inverseId} and to_record = ${recordId} and from_record in ${tx(removed)}`;
  for (const from of added) {
    await tx`
      insert into record_links (field_id, from_record, to_record, position)
      select ${inverseId}, ${from}, ${recordId}, coalesce(max(position), -1) + 1
      from record_links where field_id = ${inverseId} and from_record = ${from}
      on conflict do nothing`;
  }
  // Touch the other side so its "last modified" reflects the change.
  if (removed.length || added.length) await tx`update records set updated_at = now() where id in ${tx([...removed, ...added])}`;
}

export async function createRecords(sql: Sql, moduleId: string, inputs: { values: Record<string, unknown> }[], userId: string | null): Promise<RecordRow[]> {
  const ids = await sql.begin(async (tx) => {
    const fields = await loadFields(tx, moduleId);
    const [mod] = await tx`
      update modules set next_auto_number = next_auto_number + ${inputs.length}
      where id = ${moduleId} and deleted_at is null returning next_auto_number`;
    if (!mod) throw notFound('Module');
    let auto = mod.next_auto_number - inputs.length;
    const created: string[] = [];
    for (const input of inputs) {
      const { stored, links } = splitValues(fields, input.values);
      for (const f of fields) if (f.type === 'checkbox' && !(f.id in stored)) stored[f.id] = false;
      checkRequired(fields, stored, links);
      const [row] = await tx`
        insert into records (module_id, values, auto_number, created_by, updated_by)
        values (${moduleId}, ${tx.json(stored as never)}, ${auto++}, ${userId}, ${userId}) returning id`;
      for (const [field, targets] of links) await setLinks(tx, field, row!.id, targets);
      await tx`insert into record_history (record_id, actor_id, action, changes) values (${row!.id}, ${userId}, 'create', ${tx.json(input.values as never)})`;
      created.push(row!.id);
    }
    return created;
  });
  const rows = await sql`select * from records where id in ${sql(ids)} order by auto_number`;
  return (await computeRecords(sql, moduleId, rows)).records;
}

export async function updateRecord(sql: Sql, recordId: string, values: Record<string, unknown>, userId: string): Promise<RecordRow> {
  const moduleId = await sql.begin(async (tx) => {
    const [row] = await tx`select * from records where id = ${recordId} and deleted_at is null for update`;
    if (!row) throw notFound('Record');
    const fields = await loadFields(tx, row.module_id);
    const { stored, cleared, links } = splitValues(fields, values);
    const next = { ...row.values, ...stored };
    for (const id of cleared) delete next[id];
    const currentLinks = new Map<Field, string[]>();
    for (const f of fields.filter((f) => f.required && f.type === 'linkedRecord')) {
      currentLinks.set(f, links.get(f) ?? (await tx`select to_record from record_links where field_id = ${f.id} and from_record = ${recordId}`).map((r) => r.to_record));
    }
    checkRequired(fields, next, currentLinks);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const id of [...Object.keys(stored), ...cleared]) {
      if (JSON.stringify(row.values[id] ?? null) !== JSON.stringify(next[id] ?? null)) changes[id] = { from: row.values[id] ?? null, to: next[id] ?? null };
    }
    for (const [field, targets] of links) {
      const before = (await tx`select to_record from record_links where field_id = ${field.id} and from_record = ${recordId} order by position`).map((r) => r.to_record);
      if (JSON.stringify(before) !== JSON.stringify(targets)) changes[field.id] = { from: before, to: targets };
      await setLinks(tx, field, recordId, targets);
    }
    if (Object.keys(changes).length === 0) return row.module_id as string;

    await tx`update records set values = ${tx.json(next)}, updated_at = now(), updated_by = ${userId} where id = ${recordId}`;
    await tx`insert into record_history (record_id, actor_id, action, changes) values (${recordId}, ${userId}, 'update', ${tx.json(changes as never)})`;
    return row.module_id as string;
  });
  return getRecord(sql, recordId, moduleId);
}

export async function getRecord(db: Db, recordId: string, moduleId?: string): Promise<RecordRow & { linkedNames: Record<string, string> }> {
  const [row] = await db`select * from records where id = ${recordId} and deleted_at is null`;
  if (!row) throw notFound('Record');
  const { records, linkedNames } = await computeRecords(db, moduleId ?? row.module_id, [row]);
  return { ...records[0]!, linkedNames };
}

export async function deleteRecords(sql: Sql, recordIds: string[], userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update records set deleted_at = now(), updated_by = ${userId} where id in ${tx(recordIds)} and deleted_at is null`;
    for (const id of recordIds) await tx`insert into record_history (record_id, actor_id, action) values (${id}, ${userId}, 'delete')`;
  });
}

export async function restoreRecord(sql: Sql, recordId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx`update records set deleted_at = null, updated_by = ${userId} where id = ${recordId} and deleted_at is not null returning id`;
    if (!row) throw notFound('Deleted record');
    await tx`insert into record_history (record_id, actor_id, action) values (${recordId}, ${userId}, 'restore')`;
  });
}

export async function listRecords(db: Db, moduleId: string, query: z.infer<typeof listRecordsQuery>, userId: string) {
  const fields = await loadFields(db, moduleId);
  let config = viewConfigSchema.parse({});
  if (query.viewId) {
    const [view] = await db`
      select config from views where id = ${query.viewId} and module_id = ${moduleId}
        and (visibility <> 'personal' or owner_id = ${userId})`;
    if (!view) throw notFound('View');
    config = viewConfigSchema.parse(view.config);
  }
  const rows = await db`select * from records where module_id = ${moduleId} and deleted_at is null order by auto_number limit ${SCAN_LIMIT}`;
  const { records, linkedNames } = await computeRecords(db, moduleId, rows, fields);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const ctx = { userId, today: new Date().toISOString().slice(0, 10) };
  let result = records.filter((r) => matchesFilter(r, byId, config.filter, ctx));
  result = searchRecords(result, fields, query.search);
  result = sortRecords(result, byId, [...config.groupBy, ...config.sorts]);
  return {
    total: result.length,
    records: result.slice(query.offset, query.offset + query.limit),
    linkedNames,
  };
}

export async function addComment(db: Db, recordId: string, body: string, userId: string) {
  const [row] = await db`insert into comments (record_id, author_id, body) values (${recordId}, ${userId}, ${body}) returning *`;
  return { id: row!.id, recordId, authorId: userId, body: row!.body, createdAt: new Date(row!.created_at).toISOString() };
}

export async function listComments(db: Db, recordId: string) {
  const rows = await db`select * from comments where record_id = ${recordId} order by created_at`;
  return rows.map((r) => ({ id: r.id, recordId, authorId: r.author_id, body: r.body, createdAt: new Date(r.created_at).toISOString() }));
}

export async function listHistory(db: Db, recordId: string) {
  const rows = await db`select * from record_history where record_id = ${recordId} order by id desc limit 200`;
  return rows.map((r) => ({ id: String(r.id), actorId: r.actor_id, action: r.action, changes: r.changes, createdAt: new Date(r.created_at).toISOString() }));
}
