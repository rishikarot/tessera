import { can, type Action, type Role } from '@tessera/shared';
import type { Db } from './db.js';
import { forbidden, notFound } from './errors.js';

type Scope = 'workspace' | 'app' | 'module' | 'field' | 'view' | 'record';

/** Finds the workspace that owns an entity, or null when it does not exist. */
async function workspaceOf(db: Db, scope: Scope, id: string): Promise<string | null> {
  let rows: { workspace_id: string }[];
  switch (scope) {
    case 'workspace':
      rows = await db`select id as workspace_id from workspaces where id = ${id}`;
      break;
    case 'app':
      rows = await db`select workspace_id from apps where id = ${id} and deleted_at is null`;
      break;
    case 'module':
      rows = await db`
        select a.workspace_id from modules m join apps a on a.id = m.app_id
        where m.id = ${id} and m.deleted_at is null and a.deleted_at is null`;
      break;
    case 'field':
      rows = await db`
        select a.workspace_id from fields f join modules m on m.id = f.module_id join apps a on a.id = m.app_id
        where f.id = ${id} and f.deleted_at is null and m.deleted_at is null`;
      break;
    case 'view':
      rows = await db`
        select a.workspace_id from views v join modules m on m.id = v.module_id join apps a on a.id = m.app_id
        where v.id = ${id} and m.deleted_at is null`;
      break;
    case 'record':
      rows = await db`
        select a.workspace_id from records r join modules m on m.id = r.module_id join apps a on a.id = m.app_id
        where r.id = ${id} and r.deleted_at is null and m.deleted_at is null`;
      break;
  }
  return rows[0]?.workspace_id ?? null;
}

export async function roleIn(db: Db, workspaceId: string, userId: string): Promise<Role | null> {
  const [row] = await db<{ role: Role }[]>`select role from workspace_members where workspace_id = ${workspaceId} and user_id = ${userId}`;
  return row?.role ?? null;
}

/**
 * Throws 404 when the entity is missing or the user is not a member (so ids
 * do not leak), and 403 when the member's role is too low for the action.
 */
export async function authorize(db: Db, userId: string, scope: Scope, id: string, action: Action): Promise<Role> {
  const workspaceId = await workspaceOf(db, scope, id);
  const role = workspaceId ? await roleIn(db, workspaceId, userId) : null;
  if (!role) throw notFound(scope[0]!.toUpperCase() + scope.slice(1));
  if (!can(role, action)) throw forbidden();
  return role;
}
