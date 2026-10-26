import { z } from 'zod';
import { FIELD_TYPES } from './fields.js';
import { VIEW_TYPES, VIEW_VISIBILITIES, viewConfigSchema } from './views.js';

export const ROLES = ['owner', 'creator', 'editor', 'commenter', 'readOnly'] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | 'workspace.manage' // members, billing, delete workspace
  | 'schema.edit' // apps, modules, fields, automations, interfaces
  | 'view.lock'
  | 'view.edit' // create and change collaborative views
  | 'record.edit'
  | 'record.comment'
  | 'read';

const RANK: Record<Role, number> = { readOnly: 0, commenter: 1, editor: 2, creator: 3, owner: 4 };
const NEEDS: Record<Action, Role> = {
  'workspace.manage': 'owner',
  'schema.edit': 'creator',
  'view.lock': 'creator',
  'view.edit': 'editor',
  'record.edit': 'editor',
  'record.comment': 'commenter',
  read: 'readOnly',
};

/** Mirrors Airtable's base roles: Owner > Creator > Editor > Commenter > Read-only. */
export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[NEEDS[action]];
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  role: Role;
}

export interface App {
  id: string;
  workspaceId: string;
  name: string;
  icon: string;
  color: string;
  description: string | null;
}

export interface Module {
  id: string;
  appId: string;
  name: string;
  description: string | null;
  primaryFieldId: string | null;
  position: number;
}

export interface RecordRow {
  id: string;
  moduleId: string;
  /** Cell values keyed by field id. Computed fields are filled in on read. */
  values: Record<string, unknown>;
  autoNumber: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

// ---- API inputs ----------------------------------------------------------

const name = z.string().trim().min(1).max(200);

export const createWorkspaceInput = z.object({ name });
export const createAppInput = z.object({
  name,
  icon: z.string().max(40).default('grid'),
  color: z.string().max(20).default('blue'),
  description: z.string().max(2000).nullable().optional(),
});
export const updateAppInput = createAppInput.partial();

export const createModuleInput = z.object({
  name,
  description: z.string().max(2000).nullable().optional(),
  /** Name of the primary field created with the module. */
  primaryFieldName: name.default('Name'),
});
export const updateModuleInput = z.object({
  name: name.optional(),
  description: z.string().max(2000).nullable().optional(),
  primaryFieldId: z.string().uuid().optional(),
  position: z.number().int().optional(),
});

export const createFieldInput = z.object({
  name,
  type: z.enum(FIELD_TYPES),
  description: z.string().max(2000).nullable().optional(),
  config: z.record(z.unknown()).default({}),
  required: z.boolean().default(false),
});
export const updateFieldInput = z.object({
  name: name.optional(),
  type: z.enum(FIELD_TYPES).optional(),
  description: z.string().max(2000).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  required: z.boolean().optional(),
  position: z.number().int().optional(),
});

export const recordValuesInput = z.record(z.string().uuid(), z.unknown());
export const createRecordsInput = z.object({
  records: z.array(z.object({ values: recordValuesInput })).min(1).max(100),
});
export const updateRecordInput = z.object({ values: recordValuesInput });

export const createViewInput = z.object({
  name,
  type: z.enum(VIEW_TYPES),
  visibility: z.enum(VIEW_VISIBILITIES).default('collaborative'),
  config: viewConfigSchema.default({}),
});
export const updateViewInput = z.object({
  name: name.optional(),
  visibility: z.enum(VIEW_VISIBILITIES).optional(),
  config: viewConfigSchema.optional(),
  position: z.number().int().optional(),
});

export const listRecordsQuery = z.object({
  viewId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
