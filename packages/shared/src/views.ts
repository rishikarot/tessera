import { z } from 'zod';
import type { FieldType } from './fields.js';

export const VIEW_TYPES = ['grid', 'kanban', 'calendar', 'gallery', 'timeline', 'list', 'gantt', 'form'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const FILTER_OPERATORS = [
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte',
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isBefore',
  'isAfter',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

const TEXTUAL: FilterOperator[] = ['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty'];
const NUMERIC: FilterOperator[] = ['is', 'isNot', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'];
const DATES: FilterOperator[] = ['is', 'isBefore', 'isAfter', 'isEmpty', 'isNotEmpty'];
const EMPTINESS: FilterOperator[] = ['isEmpty', 'isNotEmpty'];

/** Which filter operators make sense for each field type. */
export function operatorsFor(type: FieldType): FilterOperator[] {
  switch (type) {
    case 'singleLineText':
    case 'longText':
    case 'email':
    case 'url':
    case 'phone':
    case 'barcode':
    case 'formula':
    case 'ai':
      return TEXTUAL;
    case 'number':
    case 'currency':
    case 'percent':
    case 'duration':
    case 'rating':
    case 'autoNumber':
    case 'count':
    case 'rollup':
      return NUMERIC;
    case 'singleSelect':
      return ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'];
    case 'multipleSelect':
    case 'linkedRecord':
    case 'lookup':
      return ['hasAnyOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'];
    case 'user':
    case 'createdBy':
    case 'lastModifiedBy':
      return ['is', 'isNot', 'isAnyOf', 'isEmpty', 'isNotEmpty'];
    case 'checkbox':
      return ['is'];
    case 'date':
    case 'createdTime':
    case 'lastModifiedTime':
      return DATES;
    default:
      return EMPTINESS;
  }
}

export const filterConditionSchema = z.object({
  fieldId: z.string().uuid(),
  operator: z.enum(FILTER_OPERATORS),
  value: z.unknown().optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const filterSchema = z.object({
  conjunction: z.enum(['and', 'or']).default('and'),
  conditions: z.array(filterConditionSchema).max(50).default([]),
});
export type Filter = z.infer<typeof filterSchema>;

export const sortSchema = z.object({ fieldId: z.string().uuid(), direction: z.enum(['asc', 'desc']).default('asc') });
export type Sort = z.infer<typeof sortSchema>;

export const viewConfigSchema = z.object({
  filter: filterSchema.default({}),
  sorts: z.array(sortSchema).max(10).default([]),
  groupBy: z.array(sortSchema).max(3).default([]),
  hiddenFieldIds: z.array(z.string().uuid()).default([]),
  fieldOrder: z.array(z.string().uuid()).default([]),
  rowHeight: z.enum(['short', 'medium', 'tall', 'extraTall']).default('short'),
  colorFieldId: z.string().uuid().nullable().default(null),
  /** Kanban: the single select or user field that defines the columns. */
  stackFieldId: z.string().uuid().nullable().default(null),
  /** Calendar, timeline and gantt: start and optional end date fields. */
  startFieldId: z.string().uuid().nullable().default(null),
  endFieldId: z.string().uuid().nullable().default(null),
  /** Gallery: the attachment field used as the card cover. */
  coverFieldId: z.string().uuid().nullable().default(null),
  /** Form: heading, intro and the fields it asks for. */
  form: z
    .object({
      title: z.string().max(200).default(''),
      description: z.string().max(2000).default(''),
      fieldIds: z.array(z.string().uuid()).default([]),
      submitLabel: z.string().max(40).default('Submit'),
      successMessage: z.string().max(500).default('Thanks, your response was recorded.'),
      isPublic: z.boolean().default(false),
    })
    .default({}),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const VIEW_VISIBILITIES = ['collaborative', 'personal', 'locked'] as const;
export type ViewVisibility = (typeof VIEW_VISIBILITIES)[number];

export interface View {
  id: string;
  moduleId: string;
  name: string;
  type: ViewType;
  visibility: ViewVisibility;
  ownerId: string | null;
  config: ViewConfig;
  position: number;
}
