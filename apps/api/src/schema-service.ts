import { randomUUID } from 'node:crypto';
import {
  PRIMARY_FIELD_TYPES,
  can,
  cellToText,
  parseFieldConfig,
  validateValue,
  viewConfigSchema,
  type App,
  type Choice,
  type Field,
  type FieldType,
  type Module,
  type Role,
  type View,
  type ViewType,
  type createAppInput,
  type createFieldInput,
  type createModuleInput,
  type createViewInput,
  type updateAppInput,
  type updateFieldInput,
  type updateModuleInput,
  type updateViewInput,
} from '@tessera/shared';
import type { z } from 'zod';
import type { Db, Sql, Tx } from './db.js';
import { badRequest, forbidden, notFound } from './errors.js';

// ---- row mappers ---------------------------------------------------------

type Row = Record<string, any>;

export const toApp = (r: Row): App => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  icon: r.icon,
  color: r.color,
  description: r.description,
});

export const toModule = (r: Row): Module => ({
  id: r.id,
  appId: r.app_id,
  name: r.name,
  description: r.description,
  primaryFieldId: r.primary_field_id,
  position: r.position,
});

export const toField = (r: Row, primaryFieldId?: string | null): Field => ({
  id: r.id,
  moduleId: r.module_id,
  name: r.name,
  type: r.type,
  description: r.description,
  config: r.config ?? {},
  position: r.position,
  isPrimary: r.id === (primaryFieldId ?? r.primary_field_id),
  required: r.required,
});

export const toView = (r: Row): View => ({
  id: r.id,
  moduleId: r.module_id,
  name: r.name,
  type: r.type,
  visibility: r.visibility,
  ownerId: r.owner_id,
  config: viewConfigSchema.parse(r.config ?? {}),
  position: r.position,
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// ---- apps ----------------------------------------------------------------

export async function listApps(db: Db, workspaceId: string): Promise<App[]> {
  const rows = await db`select * from apps where workspace_id = ${workspaceId} and deleted_at is null order by created_at`;
  return rows.map(toApp);
}

export async function createApp(db: Db, workspaceId: string, input: z.infer<typeof createAppInput>): Promise<App> {
  const [row] = await db`
    insert into apps (workspace_id, name, icon, color, description)
    values (${workspaceId}, ${input.name}, ${input.icon}, ${input.color}, ${input.description ?? null})
    returning *`;
  return toApp(row!);
}

export async function updateApp(db: Db, appId: string, input: z.infer<typeof updateAppInput>): Promise<App> {
  const [current] = await db`select * from apps where id = ${appId} and deleted_at is null`;
  if (!current) throw notFound('App');
  const [row] = await db`
    update apps set
      name = ${input.name ?? current.name},
      icon = ${input.icon ?? current.icon},
      color = ${input.color ?? current.color},
      description = ${input.description === undefined ? current.description : input.description}
    where id = ${appId} returning *`;
  return toApp(row!);
}

export async function deleteApp(db: Db, appId: string): Promise<void> {
  await db`update apps set deleted_at = now() where id = ${appId}`;
}

export async function getApp(db: Db, appId: string): Promise<App & { modules: Module[] }> {
  const [row] = await db`select * from apps where id = ${appId} and deleted_at is null`;
  if (!row) throw notFound('App');
  const modules = await db`select * from modules where app_id = ${appId} and deleted_at is null order by position, created_at`;
  return { ...toApp(row), modules: modules.map(toModule) };
}

// ---- modules -------------------------------------------------------------

export async function createModule(sql: Sql, appId: string, input: z.infer<typeof createModuleInput>, userId: string) {
  return sql.begin(async (tx) => {
    const [{ next }] = (await tx`select coalesce(max(position), -1) + 1 as next from modules where app_id = ${appId} and deleted_at is null`) as [
      { next: number },
    ];
    const [mod] = await tx`
      insert into modules (app_id, name, description, position)
      values (${appId}, ${input.name}, ${input.description ?? null}, ${next}) returning *`;
    const [field] = await tx`
      insert into fields (module_id, name, type, config, position)
      values (${mod!.id}, ${input.primaryFieldName}, 'singleLineText', ${tx.json({})}, 0) returning *`;
    const [updated] = await tx`update modules set primary_field_id = ${field!.id} where id = ${mod!.id} returning *`;
    await tx`
      insert into views (module_id, name, type, config, position)
      values (${mod!.id}, 'Grid view', 'grid', ${tx.json(viewConfigSchema.parse({}) as never)}, 0)`;
    return getModuleSchema(tx, updated!.id, userId);
  });
}

export async function updateModule(db: Db, moduleId: string, input: z.infer<typeof updateModuleInput>): Promise<Module> {
  const [current] = await db`select * from modules where id = ${moduleId} and deleted_at is null`;
  if (!current) throw notFound('Module');
  if (input.primaryFieldId) {
    const [f] = await db`select type from fields where id = ${input.primaryFieldId} and module_id = ${moduleId} and deleted_at is null`;
    if (!f) throw badRequest('Primary field must belong to this module');
    if (!PRIMARY_FIELD_TYPES.has(f.type)) throw badRequest(`A ${f.type} field cannot be the primary field`);
  }
  const [row] = await db`
    update modules set
      name = ${input.name ?? current.name},
      description = ${input.description === undefined ? current.description : input.description},
      primary_field_id = ${input.primaryFieldId ?? current.primary_field_id},
      position = ${input.position ?? current.position}
    where id = ${moduleId} returning *`;
  return toModule(row!);
}

export async function deleteModule(sql: Sql, moduleId: string): Promise<void> {
  await sql.begin(async (tx) => {
    // Links from other modules into this one would point at nothing: remove those fields too.
    const inverse = await tx`
      select id from fields
      where type = 'linkedRecord' and config->>'targetModuleId' = ${moduleId} and module_id <> ${moduleId} and deleted_at is null`;
    for (const f of inverse) await tx`update fields set deleted_at = now() where id = ${f.id}`;
    await tx`update modules set deleted_at = now() where id = ${moduleId}`;
  });
}

export async function getModuleSchema(db: Db, moduleId: string, userId: string) {
  const [mod] = await db`select * from modules where id = ${moduleId} and deleted_at is null`;
  if (!mod) throw notFound('Module');
  const fields = await loadFields(db, moduleId, mod.primary_field_id);
  const views = await db`
    select * from views where module_id = ${moduleId}
      and (visibility <> 'personal' or owner_id = ${userId})
    order by position, created_at`;
  return { module: toModule(mod), fields, views: views.map(toView) };
}

export async function loadFields(db: Db, moduleId: string, primaryFieldId?: string | null): Promise<Field[]> {
  let primary = primaryFieldId;
  if (primary === undefined) {
    const [m] = await db`select primary_field_id from modules where id = ${moduleId}`;
    primary = m?.primary_field_id ?? null;
  }
  const rows = await db`select * from fields where module_id = ${moduleId} and deleted_at is null order by position, created_at`;
  return rows.map((r) => toField(r, primary));
}

// ---- fields --------------------------------------------------------------

/** Gives select options ids and colours when the client sent only names. */
function normalizeChoices(config: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(config.choices)) return config;
  const choices = (config.choices as Partial<Choice>[]).map((c) => ({ ...c, id: c.id || `opt${randomUUID().slice(0, 8)}` }));
  return { ...config, choices };
}

async function checkConfig(db: Db, moduleId: string, type: FieldType, raw: Record<string, unknown>, selfId?: string) {
  const parsed = parseFieldConfig(type, normalizeChoices(raw));
  if (!parsed.success) throw badRequest(`Invalid settings for a ${type} field`, parsed.error.flatten());
  const config = parsed.data as Record<string, unknown>;

  if (type === 'linkedRecord') {
    const [target] = await db`
      select t.id from modules t join modules s on s.app_id = t.app_id
      where s.id = ${moduleId} and t.id = ${config.targetModuleId as string} and t.deleted_at is null`;
    if (!target) throw badRequest('Linked module must be in the same app');
  }
  if (type === 'lookup' || type === 'rollup' || type === 'count') {
    const [link] = await db`
      select config from fields
      where id = ${config.linkFieldId as string} and module_id = ${moduleId} and type = 'linkedRecord' and deleted_at is null`;
    if (!link) throw badRequest('Choose a linked record field in this module');
    if (type !== 'count') {
      const [target] = await db`
        select id from fields
        where id = ${config.targetFieldId as string} and module_id = ${link.config.targetModuleId} and deleted_at is null`;
      if (!target) throw badRequest('Choose a field from the linked module');
      if (target.id === selfId) throw badRequest('A field cannot look itself up');
    }
  }
  return config;
}

async function uniqueName(db: Db, moduleId: string, base: string): Promise<string> {
  const rows = await db`select lower(name) as n from fields where module_id = ${moduleId} and deleted_at is null`;
  const taken = new Set(rows.map((r) => r.n));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export async function createField(sql: Sql, moduleId: string, input: z.infer<typeof createFieldInput>): Promise<Field> {
  try {
    return await sql.begin(async (tx) => {
      const config = await checkConfig(tx, moduleId, input.type, input.config);
      const [{ next }] = (await tx`select coalesce(max(position), -1) + 1 as next from fields where module_id = ${moduleId} and deleted_at is null`) as [
        { next: number },
      ];
      const id = randomUUID();

      if (input.type === 'linkedRecord' && config.targetModuleId !== moduleId) {
        // Create the paired field on the other module, as Airtable does.
        const targetId = config.targetModuleId as string;
        const inverseId = randomUUID();
        const [src] = await tx`select name from modules where id = ${moduleId}`;
        const [{ pos }] = (await tx`select coalesce(max(position), -1) + 1 as pos from fields where module_id = ${targetId} and deleted_at is null`) as [
          { pos: number },
        ];
        await tx`
          insert into fields (id, module_id, name, type, config, position)
          values (${inverseId}, ${targetId}, ${await uniqueName(tx, targetId, src!.name)}, 'linkedRecord',
                  ${tx.json({ targetModuleId: moduleId, allowMultiple: true, inverseFieldId: id })}, ${pos})`;
        config.inverseFieldId = inverseId;
      }

      const [row] = await tx`
        insert into fields (id, module_id, name, type, description, config, position, required)
        values (${id}, ${moduleId}, ${input.name}, ${input.type}, ${input.description ?? null}, ${tx.json(config as never)}, ${next}, ${input.required})
        returning *`;
      return toField(row!, null);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw badRequest(`A field named "${input.name}" already exists`);
    throw err;
  }
}

/** Best-effort conversion of a stored value when a field changes type. */
function convertValue(from: Field, to: Field, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const asText = cellToText(from, value);
  if (to.type === 'singleSelect' || to.type === 'multipleSelect') {
    const choices = (to.config.choices as Choice[]) ?? [];
    const names = asText.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const ids = names.map((n) => choices.find((c) => c.name.toLowerCase() === n)?.id).filter(Boolean) as string[];
    return to.type === 'singleSelect' ? ids[0] ?? null : ids;
  }
  // Option ids mean nothing outside their field, so selects convert via their names.
  const fromSelect = from.type === 'singleSelect' || from.type === 'multipleSelect';
  const direct = fromSelect ? null : validateValue(to, value);
  if (direct?.ok) return direct.value;
  if (to.type === 'checkbox') return Boolean(value);
  const fromText = validateValue(to, asText);
  return fromText.ok ? fromText.value : null;
}

export async function updateField(sql: Sql, fieldId: string, input: z.infer<typeof updateFieldInput>): Promise<Field> {
  try {
    return await sql.begin(async (tx) => {
      const [row] = await tx`
        select f.*, m.primary_field_id from fields f join modules m on m.id = f.module_id
        where f.id = ${fieldId} and f.deleted_at is null for update of f`;
      if (!row) throw notFound('Field');
      const current = toField(row);
      const type = input.type ?? current.type;
      const typeChanged = type !== current.type;

      if (typeChanged && (type === 'linkedRecord' || current.type === 'linkedRecord')) {
        throw badRequest('Linked record fields cannot be converted; create a new field instead');
      }
      if (typeChanged && current.isPrimary && !PRIMARY_FIELD_TYPES.has(type)) {
        throw badRequest(`A ${type} field cannot be the primary field`);
      }

      let rawConfig = input.config ?? (typeChanged ? {} : current.config);
      if (typeChanged && (type === 'singleSelect' || type === 'multipleSelect') && !input.config) {
        // Turn the distinct existing values into options.
        const values = await tx`select distinct values->${fieldId} as v from records where module_id = ${current.moduleId} and deleted_at is null and values ? ${fieldId}`;
        const names = new Set<string>();
        for (const { v } of values) for (const n of cellToText(current, v).split(',')) if (n.trim()) names.add(n.trim());
        rawConfig = { choices: [...names].slice(0, 500).map((name) => ({ name })) };
      }
      if (current.type === 'linkedRecord') rawConfig = { ...current.config, ...rawConfig, targetModuleId: current.config.targetModuleId, inverseFieldId: current.config.inverseFieldId };
      const config = await checkConfig(tx, current.moduleId, type, rawConfig, fieldId);

      const [updated] = await tx`
        update fields set
          name = ${input.name ?? current.name},
          type = ${type},
          description = ${input.description === undefined ? current.description : input.description},
          config = ${tx.json(config as never)},
          required = ${input.required ?? current.required},
          position = ${input.position ?? current.position}
        where id = ${fieldId} returning *`;
      const next = toField(updated!, row.primary_field_id);

      if (typeChanged || (type === 'singleSelect' || type === 'multipleSelect')) {
        await rewriteValues(tx, current, next);
      }
      return next;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw badRequest(`A field named "${input.name}" already exists`);
    throw err;
  }
}

/** Re-validates stored values after a type or option change. */
async function rewriteValues(tx: Tx, before: Field, after: Field) {
  const rows = await tx`select id, values->${after.id} as v from records where module_id = ${after.moduleId} and values ? ${after.id}`;
  for (const { id, v } of rows) {
    let next: unknown;
    if (before.type === after.type) {
      const res = validateValue(after, v);
      next = res.ok ? res.value : null; // e.g. an option was removed
    } else {
      next = convertValue(before, after, v);
    }
    if (JSON.stringify(next) === JSON.stringify(v)) continue;
    if (next === null || (Array.isArray(next) && next.length === 0)) {
      await tx`update records set values = values - ${after.id} where id = ${id}`;
    } else {
      await tx`update records set values = jsonb_set(values, ${[after.id]}, ${tx.json(next as never)}) where id = ${id}`;
    }
  }
}

export async function deleteField(sql: Sql, fieldId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx`
      select f.*, m.primary_field_id from fields f join modules m on m.id = f.module_id
      where f.id = ${fieldId} and f.deleted_at is null`;
    if (!row) throw notFound('Field');
    if (row.primary_field_id === fieldId) throw badRequest('The primary field cannot be deleted');
    const ids = [fieldId];
    if (row.type === 'linkedRecord' && row.config.inverseFieldId) ids.push(row.config.inverseFieldId);
    await tx`update fields set deleted_at = now() where id in ${tx(ids)}`;
    await tx`delete from record_links where field_id in ${tx(ids)}`;
  });
}

// ---- views ---------------------------------------------------------------

export async function createView(db: Db, moduleId: string, input: z.infer<typeof createViewInput>, userId: string, role: Role): Promise<View> {
  if (input.visibility === 'locked' && !can(role, 'view.lock')) throw forbidden('Only creators can lock views');
  if (input.visibility !== 'personal' && !can(role, 'view.edit')) throw forbidden('You can only create personal views');
  const [{ next }] = (await db`select coalesce(max(position), -1) + 1 as next from views where module_id = ${moduleId}`) as [{ next: number }];
  const [row] = await db`
    insert into views (module_id, name, type, visibility, owner_id, config, position)
    values (${moduleId}, ${input.name}, ${input.type}, ${input.visibility},
            ${input.visibility === 'personal' ? userId : null}, ${db.json(input.config as never)}, ${next})
    returning *`;
  return toView(row!);
}

async function editableView(db: Db, viewId: string, userId: string, role: Role) {
  const [row] = await db`select * from views where id = ${viewId}`;
  if (!row) throw notFound('View');
  if (row.visibility === 'personal' && row.owner_id !== userId) throw notFound('View');
  if (row.visibility === 'locked' && !can(role, 'view.lock')) throw forbidden('This view is locked');
  if (row.visibility === 'collaborative' && !can(role, 'view.edit')) throw forbidden();
  return row;
}

export async function updateView(db: Db, viewId: string, input: z.infer<typeof updateViewInput>, userId: string, role: Role): Promise<View> {
  const current = await editableView(db, viewId, userId, role);
  if (input.visibility === 'locked' && !can(role, 'view.lock')) throw forbidden('Only creators can lock views');
  const visibility = input.visibility ?? current.visibility;
  const [row] = await db`
    update views set
      name = ${input.name ?? current.name},
      visibility = ${visibility},
      owner_id = ${visibility === 'personal' ? current.owner_id ?? userId : null},
      config = ${db.json((input.config ?? current.config) as never)},
      position = ${input.position ?? current.position}
    where id = ${viewId} returning *`;
  return toView(row!);
}

export async function deleteView(db: Db, viewId: string, userId: string, role: Role): Promise<void> {
  const current = await editableView(db, viewId, userId, role);
  const [{ n }] = (await db`select count(*)::int as n from views where module_id = ${current.module_id} and visibility <> 'personal'`) as [{ n: number }];
  if (current.visibility !== 'personal' && n <= 1) throw badRequest('A module needs at least one shared view');
  await db`delete from views where id = ${viewId}`;
}

export const DEFAULT_VIEW_NAMES: Record<ViewType, string> = {
  grid: 'Grid view',
  kanban: 'Kanban',
  calendar: 'Calendar',
  gallery: 'Gallery',
  timeline: 'Timeline',
  list: 'List',
  gantt: 'Gantt',
  form: 'Form',
};
