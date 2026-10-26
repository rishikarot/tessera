import { z } from 'zod';

/**
 * Every field type Tessera supports. Each type has a config schema (how the
 * field is set up), a value shape (what a cell holds) and a flag saying
 * whether users can write to it or the system computes it.
 */
export const FIELD_TYPES = [
  // Text
  'singleLineText',
  'longText',
  'email',
  'url',
  'phone',
  // Numbers
  'number',
  'currency',
  'percent',
  'duration',
  'rating',
  'autoNumber',
  // Choice
  'singleSelect',
  'multipleSelect',
  'checkbox',
  // Date and time
  'date',
  'createdTime',
  'lastModifiedTime',
  // People
  'user',
  'createdBy',
  'lastModifiedBy',
  // Relations and computed
  'linkedRecord',
  'lookup',
  'rollup',
  'count',
  'formula',
  // Files and actions
  'attachment',
  'barcode',
  'button',
  'ai',
  'signature',
  'location',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const CHOICE_COLORS = ['gray', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'] as const;

const choiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  color: z.enum(CHOICE_COLORS).default('gray'),
});
export type Choice = z.infer<typeof choiceSchema>;

const precision = z.number().int().min(0).max(8).default(0);

export const ROLLUP_AGGREGATES = ['sum', 'avg', 'min', 'max', 'count', 'countAll', 'arrayJoin', 'arrayUnique'] as const;

export const fieldConfigSchemas = {
  singleLineText: z.object({}).default({}),
  longText: z.object({ richText: z.boolean().default(false) }).default({}),
  email: z.object({}).default({}),
  url: z.object({}).default({}),
  phone: z.object({}).default({}),
  number: z.object({ precision }).default({}),
  currency: z.object({ symbol: z.string().max(4).default('$'), precision: precision.default(2) }).default({}),
  percent: z.object({ precision }).default({}),
  duration: z.object({ format: z.enum(['h:mm', 'h:mm:ss']).default('h:mm') }).default({}),
  rating: z.object({ max: z.number().int().min(1).max(10).default(5), icon: z.enum(['star', 'heart', 'dot']).default('star') }).default({}),
  autoNumber: z.object({}).default({}),
  singleSelect: z.object({ choices: z.array(choiceSchema).default([]) }).default({}),
  multipleSelect: z.object({ choices: z.array(choiceSchema).default([]) }).default({}),
  checkbox: z.object({}).default({}),
  date: z.object({ includeTime: z.boolean().default(false), timeZone: z.string().default('UTC') }).default({}),
  createdTime: z.object({}).default({}),
  lastModifiedTime: z.object({}).default({}),
  user: z.object({ allowMultiple: z.boolean().default(false) }).default({}),
  createdBy: z.object({}).default({}),
  lastModifiedBy: z.object({}).default({}),
  linkedRecord: z.object({
    targetModuleId: z.string().uuid(),
    allowMultiple: z.boolean().default(true),
    /** The paired field on the target module; null for self-links. Set by the server. */
    inverseFieldId: z.string().uuid().nullable().default(null),
  }),
  lookup: z.object({ linkFieldId: z.string().uuid(), targetFieldId: z.string().uuid() }),
  rollup: z.object({
    linkFieldId: z.string().uuid(),
    targetFieldId: z.string().uuid(),
    aggregate: z.enum(ROLLUP_AGGREGATES).default('sum'),
  }),
  count: z.object({ linkFieldId: z.string().uuid() }),
  formula: z.object({ expression: z.string().max(10_000).default('') }).default({}),
  attachment: z.object({}).default({}),
  barcode: z.object({}).default({}),
  button: z.object({
    label: z.string().max(60).default('Open'),
    action: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('url'), url: z.string() }),
        z.object({ kind: z.literal('automation'), automationId: z.string().uuid() }),
      ])
      .optional(),
  }).default({}),
  ai: z.object({ prompt: z.string().max(4000).default(''), sourceFieldIds: z.array(z.string().uuid()).default([]) }).default({}),
  signature: z.object({}).default({}),
  location: z.object({}).default({}),
} satisfies Record<FieldType, z.ZodTypeAny>;

export type FieldConfig<T extends FieldType = FieldType> = z.infer<(typeof fieldConfigSchemas)[T]>;

/** Field types whose values the system computes; users cannot write them. */
export const COMPUTED_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'lookup',
  'rollup',
  'count',
  'formula',
  'button',
  'ai',
]);

/** Types that can be a module's primary (record name) field. */
export const PRIMARY_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'singleLineText',
  'longText',
  'email',
  'url',
  'phone',
  'number',
  'currency',
  'percent',
  'autoNumber',
  'date',
  'createdTime',
  'formula',
  'barcode',
]);

export function isComputed(type: FieldType): boolean {
  return COMPUTED_FIELD_TYPES.has(type);
}

export interface Field {
  id: string;
  moduleId: string;
  name: string;
  type: FieldType;
  description: string | null;
  config: Record<string, unknown>;
  position: number;
  isPrimary: boolean;
  required: boolean;
}

export function parseFieldConfig(type: FieldType, config: unknown) {
  return fieldConfigSchemas[type].safeParse(config ?? {});
}

export const attachmentSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  mimeType: z.string().optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-.\s]{3,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ValueResult = { ok: true; value: unknown } | { ok: false; error: string };

const ok = (value: unknown): ValueResult => ({ ok: true, value });
const fail = (error: string): ValueResult => ({ ok: false, error });

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Validates and normalises a value a user writes into a cell. Empty values
 * clear the cell and come back as null. Computed fields are rejected.
 */
export function validateValue(field: Pick<Field, 'type' | 'config' | 'name'>, value: unknown): ValueResult {
  const { type } = field;
  if (isComputed(type)) return fail(`"${field.name}" is computed and cannot be edited`);
  if (type === 'checkbox') return value === null || value === undefined ? ok(false) : typeof value === 'boolean' ? ok(value) : fail('Expected true or false');
  if (isEmpty(value)) return ok(null);

  switch (type) {
    case 'singleLineText':
      return typeof value === 'string' ? ok(value.replace(/[\r\n]+/g, ' ')) : fail('Expected text');
    case 'longText':
      return typeof value === 'string' ? ok(value) : fail('Expected text');
    case 'email':
      return typeof value === 'string' && EMAIL_RE.test(value.trim()) ? ok(value.trim()) : fail('Expected an email address');
    case 'url': {
      if (typeof value !== 'string') return fail('Expected a URL');
      const raw = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
      try {
        const u = new URL(raw);
        return u.protocol === 'http:' || u.protocol === 'https:' ? ok(u.toString()) : fail('Only http and https links are allowed');
      } catch {
        return fail('Expected a URL');
      }
    }
    case 'phone':
      return typeof value === 'string' && PHONE_RE.test(value) ? ok(value.trim()) : fail('Expected a phone number');
    case 'number':
    case 'currency':
    case 'percent': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return fail('Expected a number');
      const cfg = field.config as { precision?: number };
      return ok(round(n, cfg.precision ?? (type === 'currency' ? 2 : 0)));
    }
    case 'duration': {
      const n = typeof value === 'string' ? Number(value) : value;
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? ok(Math.round(n)) : fail('Expected a duration in seconds');
    }
    case 'rating': {
      const max = (field.config as { max?: number }).max ?? 5;
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
        ? ok(value === 0 ? null : value)
        : fail(`Expected a whole number from 0 to ${max}`);
    }
    case 'singleSelect': {
      const choices = ((field.config as { choices?: Choice[] }).choices ?? []).map((c) => c.id);
      return typeof value === 'string' && choices.includes(value) ? ok(value) : fail('Unknown option');
    }
    case 'multipleSelect': {
      const choices = new Set(((field.config as { choices?: Choice[] }).choices ?? []).map((c) => c.id));
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && choices.has(v))) return fail('Unknown option');
      return ok([...new Set(value)]);
    }
    case 'date': {
      if (typeof value !== 'string') return fail('Expected a date');
      const includeTime = (field.config as { includeTime?: boolean }).includeTime ?? false;
      if (!includeTime) return DATE_RE.test(value) && !Number.isNaN(Date.parse(value)) ? ok(value) : fail('Expected a date as YYYY-MM-DD');
      const t = Date.parse(value);
      return Number.isNaN(t) ? fail('Expected a date and time') : ok(new Date(t).toISOString());
    }
    case 'user': {
      const multiple = (field.config as { allowMultiple?: boolean }).allowMultiple ?? false;
      if (multiple) return Array.isArray(value) && value.every((v) => typeof v === 'string') ? ok([...new Set(value)]) : fail('Expected a list of users');
      return typeof value === 'string' ? ok(value) : fail('Expected a user');
    }
    case 'linkedRecord': {
      const ids = Array.isArray(value) ? value : [value];
      if (!ids.every((v) => typeof v === 'string')) return fail('Expected record ids');
      const unique = [...new Set(ids as string[])];
      const multiple = (field.config as { allowMultiple?: boolean }).allowMultiple ?? true;
      if (!multiple && unique.length > 1) return fail('Only one linked record is allowed');
      return ok(unique);
    }
    case 'attachment': {
      const parsed = z.array(attachmentSchema).safeParse(value);
      return parsed.success ? ok(parsed.data) : fail('Expected a list of files');
    }
    case 'barcode': {
      const parsed = z.object({ text: z.string().min(1), type: z.string().optional() }).safeParse(typeof value === 'string' ? { text: value } : value);
      return parsed.success ? ok(parsed.data) : fail('Expected a barcode');
    }
    case 'signature':
      return typeof value === 'string' && value.startsWith('data:image/') ? ok(value) : fail('Expected a signature image');
    case 'location': {
      const parsed = z
        .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), address: z.string().optional() })
        .safeParse(value);
      return parsed.success ? ok(parsed.data) : fail('Expected a location');
    }
    default:
      return fail(`Unsupported field type ${type}`);
  }
}

/** Plain-text rendering of a cell, used for record names, search and CSV export. */
export function cellToText(field: Pick<Field, 'type' | 'config'>, value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'singleSelect':
    case 'multipleSelect': {
      const names = new Map(((field.config.choices as Choice[] | undefined) ?? []).map((c) => [c.id, c.name]));
      return (Array.isArray(value) ? value : [value]).map((v) => names.get(String(v)) ?? '').filter(Boolean).join(', ');
    }
    case 'checkbox':
      return value ? 'checked' : '';
    case 'currency': {
      const { symbol = '$', precision = 2 } = field.config as { symbol?: string; precision?: number };
      return typeof value === 'number' ? `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })}` : String(value);
    }
    case 'percent':
      return typeof value === 'number' ? `${value}%` : String(value);
    case 'duration': {
      if (typeof value !== 'number') return String(value);
      const h = Math.floor(value / 3600);
      const m = Math.floor((value % 3600) / 60);
      const s = value % 60;
      const withSeconds = (field.config as { format?: string }).format === 'h:mm:ss';
      return `${h}:${String(m).padStart(2, '0')}${withSeconds ? `:${String(s).padStart(2, '0')}` : ''}`;
    }
    case 'attachment':
      return Array.isArray(value) ? value.map((a) => (a as Attachment).name).join(', ') : '';
    case 'barcode':
      return (value as { text?: string }).text ?? '';
    case 'location':
      return (value as { address?: string; lat?: number; lng?: number }).address ?? `${(value as { lat: number }).lat}, ${(value as { lng: number }).lng}`;
    default:
      if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(', ');
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}
